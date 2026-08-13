# Allow Google to return additional/broader scopes (e.g. https://mail.google.com/) without oauthlib raising "Scope has changed"
import os
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import base64
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone
import logging
import uuid
import random
from services.error_logging_service import error_logger
from services.encryption_helper import decrypt_value

class GmailService:
    def __init__(self, db, plan_service=None, admin_db=None):
        self.db = db
        self.plan_service = plan_service
        self.admin_db = admin_db
        # Default redirect_uri (used when resolving client config)
        backend_url = os.getenv("BACKEND_URL", "http://localhost:8001")
        self._default_redirect_uri = os.getenv(
            "GOOGLE_REDIRECT_URI", f"{backend_url}/api/gmail/callback"
        )
        self.scopes = [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify'
        ]

    async def _get_client_config(self, user_id: str) -> dict:
        """Resolve client_id, client_secret, redirect_uri for this user. User's own config first, then app default if this user has it enabled."""
        settings = await self.db.user_settings.find_one(
            {"user_id": user_id},
            {"google_oauth_client_id": 1, "google_oauth_client_secret_encrypted": 1, "use_app_google_oauth": 1},
        )
        # 1) User's own Google OAuth credentials
        if settings and settings.get("google_oauth_client_id") and settings.get("google_oauth_client_secret_encrypted"):
            try:
                secret = decrypt_value(settings["google_oauth_client_secret_encrypted"])
                return {
                    "client_id": settings["google_oauth_client_id"].strip(),
                    "client_secret": secret,
                    "redirect_uri": self._default_redirect_uri,
                }
            except Exception as e:
                logging.warning("Failed to decrypt user Google OAuth secret for user_id=%s: %s", user_id, e)
        # 2) App default (.env) when this user has use_app_google_oauth enabled (default False for new users)
        if settings and settings.get("use_app_google_oauth") is True:
            cid = os.getenv("GOOGLE_CLIENT_ID", "").strip()
            secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
            if cid and secret:
                return {
                    "client_id": cid,
                    "client_secret": secret,
                    "redirect_uri": self._default_redirect_uri,
                }
        raise Exception(
            "Google OAuth credentials not set. Add your Google Client ID and Secret in Settings → Integrations to connect Gmail."
        )

    async def get_auth_url(self, user_id: str, credential_id: str = None) -> str:
        """Generate Gmail OAuth URL. credential_id omitted = add new account; provided = re-auth that account."""
        if self.plan_service:
            user = await self.db.users.find_one({"id": user_id}, {"_id": 0})
            if user:
                limits = await self.plan_service.get_user_limits(user)
                max_google = limits.get("max_google_accounts", 0)
                if max_google == 0:
                    raise Exception(
                        "Your plan does not include Google accounts. Upgrade your plan to connect Gmail."
                    )
        config = await self._get_client_config(user_id)
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": config["client_id"],
                    "client_secret": config["client_secret"],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [config["redirect_uri"]]
                }
            },
            scopes=self.scopes,
            redirect_uri=config["redirect_uri"]
        )
        state = f"{user_id}:{uuid.uuid4()}"
        state_doc = {"state": state, "user_id": user_id, "created_at": datetime.now(timezone.utc)}
        if credential_id:
            state_doc["credential_id"] = credential_id
        await self.db.oauth_states.insert_one(state_doc)
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',
            state=state
        )
        return auth_url
    
    async def _resolve_credential_id(self, sender_id: str, user_id: str) -> str:
        """Resolve sender_id + user_id to gmail_credentials id."""
        if sender_id == user_id:
            cred_doc = await self.db.gmail_credentials.find_one({"user_id": user_id})
            if not cred_doc:
                raise Exception("Gmail not connected. Please connect your Gmail account in Settings.")
            return cred_doc.get("id") or cred_doc.get("user_id")
        inbox = await self.db.inboxes.find_one({"id": sender_id})
        if not inbox or inbox.get("sender_type") != "gmail":
            raise Exception(f"No Gmail inbox found for sender_id={sender_id}")
        cred_id = inbox.get("gmail_credentials_id")
        if not cred_id:
            raise Exception(f"Gmail inbox {sender_id} has no gmail_credentials_id")
        return cred_id
    
    async def get_credentials_by_id(self, credential_id: str) -> Credentials:
        """Get and refresh Gmail credentials by credential id."""
        cred_doc = await self.db.gmail_credentials.find_one({"id": credential_id})
        if not cred_doc:
            cred_doc = await self.db.gmail_credentials.find_one({"user_id": credential_id})
        if not cred_doc:
            error_msg = "Gmail not connected. Please connect your Gmail account in Settings."
            await error_logger.log_error(
                service="gmail",
                error_type="auth_error",
                error_message=error_msg,
                user_id=None,
                severity="error"
            )
            raise Exception(error_msg)
        user_id = cred_doc.get("user_id")
        refresh_token = cred_doc.get("refresh_token")
        if not refresh_token:
            raise Exception("Gmail refresh token missing. Please disconnect and reconnect your Gmail account in Settings.")
        config = await self._get_client_config(user_id)
        credentials = Credentials(
            token=cred_doc.get("access_token"),
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=config["client_id"],
            client_secret=config["client_secret"],
            scopes=cred_doc.get("scopes", self.scopes)
        )
        try:
            credentials.refresh(Request())
            await self.db.gmail_credentials.update_one(
                {"_id": cred_doc["_id"]},
                {"$set": {
                    "access_token": credentials.token,
                    "token_expiry": credentials.expiry.isoformat() if credentials.expiry else None,
                    "updated_at": datetime.now(timezone.utc)
                }}
            )
        except Exception as e:
            await error_logger.log_exception(
                service="gmail",
                exception=e,
                error_type="auth_error",
                user_id=user_id,
                metadata={"gmail_email": cred_doc.get("gmail_email"), "action": "token_refresh"},
                severity="error"
            )
            raise Exception(f"Gmail token refresh failed: {str(e)}. Please disconnect and reconnect your Gmail account in Settings.")
        return credentials
    
    async def handle_callback(self, code: str, state: str) -> str:
        """Handle OAuth callback and store credentials"""
        state_doc = await self.db.oauth_states.find_one({"state": state})
        if not state_doc:
            raise Exception("Invalid or expired OAuth state. Please try connecting again.")
        
        user_id = state_doc["user_id"]
        credential_id = state_doc.get("credential_id")
        logging.info(f"Handling OAuth callback for user_id: {user_id}, credential_id: {credential_id}")
        config = await self._get_client_config(user_id)
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": config["client_id"],
                    "client_secret": config["client_secret"],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [config["redirect_uri"]]
                }
            },
            scopes=self.scopes,
            redirect_uri=config["redirect_uri"]
        )
        flow.fetch_token(code=code)
        credentials = flow.credentials
        if not credentials.refresh_token:
            logging.warning(f"No refresh token received for user_id: {user_id}. User may need to revoke app access and reconnect.")
        
        service = build('gmail', 'v1', credentials=credentials)
        profile = service.users().getProfile(userId='me').execute()
        gmail_email = profile['emailAddress']
        logging.info(f"Gmail connected for email: {gmail_email}")
        
        now = datetime.now(timezone.utc)
        token_data = {
            "gmail_email": gmail_email,
            "access_token": credentials.token,
            "refresh_token": credentials.refresh_token,
            "token_expiry": credentials.expiry.isoformat() if credentials.expiry else None,
            "scopes": list(credentials.scopes) if credentials.scopes else self.scopes,
            "updated_at": now
        }
        
        if credential_id:
            await self.db.gmail_credentials.update_one(
                {"id": credential_id, "user_id": user_id},
                {"$set": token_data}
            )
        else:
            # Don't add if this Gmail is already connected by any user (global)
            gmail_email_lower = (gmail_email or "").strip().lower()
            if gmail_email_lower:
                existing_inbox = await self.db.inboxes.find_one(
                    {"sender_type": "gmail", "email": {"$regex": f"^{re.escape(gmail_email_lower)}$", "$options": "i"}}
                )
                if existing_inbox:
                    await self.db.oauth_states.delete_one({"state": state})
                    raise Exception(f"This Gmail account ({gmail_email}) is already connected by another user. Each Gmail can only be connected to one account.")
            # Plan limit: check Gmail inbox count against max_google_accounts
            if self.plan_service:
                user = await self.db.users.find_one({"id": user_id}, {"_id": 0})
                if user:
                    limits = await self.plan_service.get_user_limits(user)
                    count = await self.plan_service.gmail_inboxes_count(user_id)
                    max_google = limits.get("max_google_accounts", 0)
                    if max_google != -1 and count >= max_google:
                        raise Exception(
                            f"Plan limit reached: maximum {max_google} Gmail inboxes. Upgrade to add more."
                        )
            cred_id = str(uuid.uuid4())
            await self.db.gmail_credentials.insert_one({
                "id": cred_id,
                "user_id": user_id,
                **token_data,
                "created_at": now
            })
            await self.db.inboxes.insert_one({
                "id": cred_id,
                "user_id": user_id,
                "email": gmail_email,
                "sender_type": "gmail",
                "gmail_credentials_id": cred_id,
                "warmup_progress": 100,
                "daily_limit": 50,
                "sent_today": 0,
                "status": "ready",
                "created_at": now,
                "updated_at": now,
            })
        
        await self.db.oauth_states.delete_one({"state": state})
        return user_id
    
    async def get_credentials(self, user_id: str) -> Credentials:
        """Get and refresh Gmail credentials (first credential for user_id, for backward compat)."""
        cred_doc = await self.db.gmail_credentials.find_one({"user_id": user_id})
        if not cred_doc:
            raise Exception("Gmail not connected. Please connect your Gmail account in Settings.")
        cid = cred_doc.get("id") or cred_doc.get("user_id")
        return await self.get_credentials_by_id(cid)
    
    async def is_connected(self, identifier: str) -> bool:
        """Check if user/credential has Gmail connected. identifier is user_id or credential_id."""
        cred_by_id = await self.db.gmail_credentials.find_one({"id": identifier})
        if cred_by_id:
            return True
        cred_by_user = await self.db.gmail_credentials.find_one({"user_id": identifier})
        return cred_by_user is not None
    
    async def get_user_email(self, identifier: str) -> str:
        """Get Gmail email. identifier is user_id or credential_id."""
        cred_doc = await self.db.gmail_credentials.find_one({"id": identifier})
        if not cred_doc:
            cred_doc = await self.db.gmail_credentials.find_one({"user_id": identifier})
        return cred_doc.get("gmail_email") if cred_doc else None
    
    def _ensure_angle_brackets(self, msg_id: str) -> str:
        """Ensure message id is in angle brackets for In-Reply-To/References."""
        if not msg_id or not msg_id.strip():
            return msg_id or ""
        s = msg_id.strip()
        return s if s.startswith("<") and s.endswith(">") else f"<{s}>"

    async def send_email(
        self,
        sender_id: str,
        user_id: str,
        to_email: str,
        subject: str,
        body: str,
        tracking_pixel_url: str = None,
        sender_name: str = None,
        reply_to: str = None,
        body_type: str = "html",
        outbound_message_id: str = None,
        cc: str = None,
        in_reply_to: str = None,
        references: str = None,
        unsubscribe_url: str = None,
    ) -> dict:
        """Send email via Gmail API. sender_id is inbox id or user_id (legacy). body_type: 'html' or 'plain'. outbound_message_id sets Message-ID; in_reply_to/references enable threading so To and CC see the same conversation."""
        try:
            credential_id = await self._resolve_credential_id(sender_id, user_id)
            credentials = await self.get_credentials_by_id(credential_id)
            service = build('gmail', 'v1', credentials=credentials)
            
            sender_email = await self.get_user_email(credential_id)
            
            # Create message
            message = MIMEMultipart('alternative')
            message['To'] = to_email
            message['Subject'] = subject
            if outbound_message_id:
                message['Message-ID'] = self._ensure_angle_brackets(outbound_message_id)
            
            # Set From header with sender name if provided
            if sender_name:
                message['From'] = f'{sender_name} <{sender_email}>'
            else:
                message['From'] = sender_email
            
            # Reply-To: when set (e.g. for SMTP fallback), replies go to this address
            if reply_to:
                message['Reply-To'] = reply_to
            # CC: loop copy to outside mailbox(es)
            if cc:
                message['Cc'] = cc.strip()
            # Threading: so To and CC see campaign → reply → our reply in one thread
            if in_reply_to:
                message['In-Reply-To'] = self._ensure_angle_brackets(in_reply_to)
            if references:
                message['References'] = references.strip()
            if unsubscribe_url:
                message['List-Unsubscribe'] = f'<{unsubscribe_url}>'
                message['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'

            has_html_markup = bool(re.search(r"</?[a-zA-Z][^>]*>", body or ""))
            effective_body_type = "html" if body_type == "plain" and has_html_markup else body_type

            if effective_body_type == "plain":
                # Plain text: send as text/plain (no tracking pixel in body)
                message.attach(MIMEText(body, 'plain'))
            else:
                # HTML: use body as-is if it looks like full HTML, else wrap and convert newlines
                body_stripped_lower = body.strip().lower()
                if body_stripped_lower.startswith("<!doctype") or body_stripped_lower.startswith("<html"):
                    html_content = body
                else:
                    html_body = body.replace('\n', '<br>\n')
                    html_content = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {{ font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }}
    </style>
</head>
<body>
{html_body}
</body>
</html>'''
                # Only inject tracking image when there is no existing <img> tag in the HTML.
                # Use a small random size (not 1x1) and keep it visible (transparent image).
                if tracking_pixel_url and "<img" not in html_content.lower():
                    width = random.randint(3, 12)
                    height = random.randint(3, 12)
                    pixel_img = f'<img src="{tracking_pixel_url}" width="{width}" height="{height}" />'
                    if "</body>" in html_content:
                        html_content = html_content.replace("</body>", pixel_img + "\n</body>")
                    else:
                        html_content += pixel_img
                message.attach(MIMEText(html_content, 'html'))
            
            # Encode message
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
            
            # Send
            result = service.users().messages().send(
                userId='me',
                body={'raw': raw_message}
            ).execute()
            
            return {
                "message_id": result['id'],
                "thread_id": result.get('threadId'),
                "status": "sent"
            }
            
        except HttpError as error:
            logging.error(f"Gmail API error: {error}")
            raise Exception(f"Failed to send email: {str(error)}")
    
    async def check_replies(self, sender_id: str, user_id: str, thread_ids: list) -> list:
        """Check for replies in threads. sender_id is inbox id or user_id (legacy)."""
        try:
            credential_id = await self._resolve_credential_id(sender_id, user_id)
            credentials = await self.get_credentials_by_id(credential_id)
            service = build('gmail', 'v1', credentials=credentials)
            
            replies = []
            
            for thread_id in thread_ids:
                try:
                    thread = service.users().threads().get(
                        userId='me',
                        id=thread_id,
                        format='full'
                    ).execute()
                    
                    messages = thread.get('messages', [])
                    # Sort by internalDate so order is chronological (Gmail API does not guarantee order)
                    def _msg_time(m):
                        t = m.get('internalDate') or 0
                        return int(t) if t else 0
                    messages = sorted(messages, key=_msg_time)
                    # Check if thread has more than 1 message (indicating reply)
                    if len(messages) > 1:
                        # The last message is the most recent one in the thread
                        last_message = messages[-1]
                        label_ids = last_message.get('labelIds', [])
                        if 'SENT' in label_ids:
                            # If the last message was sent by us, use the most recent received message
                            received_messages = [m for m in messages if 'SENT' not in m.get('labelIds', [])]
                            if received_messages:
                                last_message = received_messages[-1]
                            else:
                                continue  # No received messages yet
                        
                        reply_body = self.parse_gmail_message(last_message)
                        
                        replies.append({
                            "thread_id": thread_id,
                            "reply_count": len(messages) - 1,
                            "reply_body": reply_body,
                            "last_message_id": last_message.get('id')
                        })
                except HttpError as err:
                    status = getattr(getattr(err, "resp", None), "status", None)
                    logging.warning(
                        "check_replies: skip thread %s: %s (status=%s)",
                        thread_id, str(err), status,
                    )
                    continue
            
            return replies
            
        except HttpError as error:
            logging.error(f"Gmail API error: {error}")
            return []

    async def list_recent_inbox_message_ids(self, user_id: str, max_results: int = 100, credential_id: str = None) -> list:
        """List recent message IDs in the user's Gmail INBOX (for matching SMTP reply detection). credential_id optional to use a specific Gmail account."""
        try:
            credentials = await self.get_credentials_by_id(credential_id) if credential_id else await self.get_credentials(user_id)
            service = build('gmail', 'v1', credentials=credentials)
            result = service.users().messages().list(
                userId='me',
                labelIds=['INBOX'],
                maxResults=max_results,
            ).execute()
            messages = result.get('messages', [])
            return [m['id'] for m in messages]
        except HttpError as error:
            logging.warning("list_recent_inbox_message_ids failed: %s", error)
            return []

    def _normalize_message_ids(self, header_value: str) -> list:
        """Parse In-Reply-To or References header into a list of normalized message ids (strip angle brackets)."""
        if not header_value or not header_value.strip():
            return []
        ids = []
        for part in header_value.replace(',', ' ').split():
            part = part.strip()
            if part.startswith('<') and part.endswith('>'):
                part = part[1:-1]
            if part:
                ids.append(part)
        return ids

    async def get_inbox_message_headers_and_body(self, user_id: str, message_id: str, credential_id: str = None) -> dict:
        """Get In-Reply-To, References, and body for an inbox message (for SMTP reply matching). credential_id optional to use a specific Gmail account."""
        try:
            credentials = await self.get_credentials_by_id(credential_id) if credential_id else await self.get_credentials(user_id)
            service = build('gmail', 'v1', credentials=credentials)
            msg = service.users().messages().get(
                userId='me',
                id=message_id,
                format='full',
            ).execute()
            payload = msg.get('payload', {})
            headers = payload.get('headers', [])
            header_map = {h['name'].lower(): h.get('value', '') for h in headers}
            in_reply_to = header_map.get('in-reply-to', '')
            references = header_map.get('references', '')
            reply_ids = set()
            reply_ids.update(self._normalize_message_ids(in_reply_to))
            reply_ids.update(self._normalize_message_ids(references))
            body = self.parse_gmail_message(msg)
            return {"reply_to_ids": reply_ids, "body": body}
        except HttpError as error:
            logging.warning("get_inbox_message_headers_and_body %s failed: %s", message_id, error)
            return {"reply_to_ids": set(), "body": ""}

    def parse_gmail_message(self, message):
        """Parse Gmail message payload to extract body"""
        payload = message.get('payload', {})
        
        # Snippet is a good fallback/preview, but we want the full body if possible
        snippet = message.get('snippet', '')
        
        body = self._extract_body_from_payload(payload)
        
        if not body:
            return snippet
            
        return body

    def _extract_body_from_payload(self, payload):
        """Recursively extract body from payload parts"""
        mime_type = payload.get('mimeType')
        parts = payload.get('parts', [])
        data = payload.get('body', {}).get('data')
        
        # Base case: we found data in this part
        if data:
            try:
                decoded_data = base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
                if mime_type == 'text/plain' or mime_type == 'text/html':
                    return decoded_data
            except Exception as e:
                logging.error(f"Error decoding Gmail body: {e}")
                
        # Recursive case: check parts
        if not parts:
            return ""
            
        plain_text = ""
        html_text = ""
        
        for part in parts:
            part_mime = part.get('mimeType')
            part_body = self._extract_body_from_payload(part)
            
            if part_mime == 'text/plain':
                plain_text += part_body
            elif part_mime == 'text/html':
                html_text += part_body
            elif part_mime.startswith('multipart/'):
                # For nested multiparts, the recursive call returns the best content from it
                # We need to decide where to put it. 
                # If it contains both, we'll just append it to whichever is empty or both.
                # Usually we want to preserve the hierarchy.
                if part_body:
                    if "<html>" in part_body.lower() or "<div" in part_body.lower():
                        html_text += part_body
                    else:
                        plain_text += part_body

        return plain_text or html_text or ""