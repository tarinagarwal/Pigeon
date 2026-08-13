import openpyxl
import csv
from io import BytesIO, StringIO
from typing import List, Dict, Tuple
import uuid
from datetime import datetime, timezone


class UploadContactError(Exception):
    """Structured error for contact upload with user-friendly message and fix."""

    def __init__(self, code: str, message: str, fix: str, detail: str = ""):
        self.code = code
        self.message = message
        self.fix = fix
        self.detail = detail or message
        super().__init__(message)

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "fix": self.fix,
            "detail": self.detail,
        }


# Max file size: 10 MB
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
CSV_ENCODINGS = ["utf-8", "utf-8-sig", "cp1252", "latin-1", "iso-8859-1", "windows-1252", "cp850", "macroman"]


def _decode_csv(content: bytes) -> str:
    """Try multiple encodings to decode CSV content."""
    for encoding in CSV_ENCODINGS:
        try:
            return content.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    raise UploadContactError(
        code="ENCODING_ERROR",
        message="We couldn't read the file's text encoding.",
        fix="Save your file as UTF-8 (in Excel: Save As → CSV UTF-8), or use the example CSV format.",
        detail="File could not be decoded with UTF-8, UTF-8-sig, CP1252, or Latin-1.",
    )


class ExcelService:
    def parse_excel(self, file_contents: bytes, filename: str = "") -> List[Dict]:
        """Parse Excel or CSV file and return list of rows. Raises UploadContactError on failure."""
        if not file_contents or len(file_contents) == 0:
            raise UploadContactError(
                code="FILE_EMPTY",
                message="The file is empty.",
                fix="Choose a file that contains a header row and at least one contact row (e.g. email, name).",
            )

        if len(file_contents) > MAX_UPLOAD_BYTES:
            raise UploadContactError(
                code="FILE_TOO_LARGE",
                message=f"File is too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB).",
                fix="Split your file into smaller files or remove unnecessary columns.",
                detail=f"Size: {len(file_contents) / (1024*1024):.1f} MB",
            )

        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext and ext not in ALLOWED_EXTENSIONS:
            raise UploadContactError(
                code="INVALID_FILE_TYPE",
                message=f"File type not supported: {ext or 'unknown'}.",
                fix="Use a CSV (.csv) or Excel (.xlsx, .xls) file. Download our example CSV if needed.",
            )

        try:
            # Try Excel first (by content: xlsx/xls have magic bytes)
            if file_contents[:4] == b"PK\x03\x04" or file_contents[:8] == b"\xd0\xcf\x11\xe0":
                return self._parse_excel_bytes(file_contents)
            # Otherwise try CSV (possibly with BOM or other encoding)
            return self._parse_csv_bytes(file_contents)
        except UploadContactError:
            raise
        except Exception as e:
            raise UploadContactError(
                code="PARSE_ERROR",
                message="We couldn't read the file format.",
                fix="Ensure the file is a valid CSV or Excel file. Use the example CSV format or export from Excel as CSV UTF-8.",
                detail=str(e),
            )

    def _parse_excel_bytes(self, file_contents: bytes) -> List[Dict]:
        try:
            workbook = openpyxl.load_workbook(BytesIO(file_contents), data_only=True)
            sheet = workbook.active
            if not sheet:
                raise UploadContactError(
                    code="NO_SHEET",
                    message="The Excel file has no sheet.",
                    fix="Open the file in Excel and ensure the first sheet has a header row and data.",
                )

            headers = []
            for cell in sheet[1]:
                if cell.value:
                    headers.append(str(cell.value).strip())

            if not headers:
                raise UploadContactError(
                    code="NO_HEADERS",
                    message="No header row found in the first row.",
                    fix="Add a first row with column names (e.g. email, first_name, last_name). See the example CSV.",
                )

            data = []
            for row in sheet.iter_rows(min_row=2, values_only=True):
                if not any(v is not None and str(v).strip() for v in row):
                    continue
                row_data = {}
                for i, value in enumerate(row):
                    if i < len(headers) and value is not None:
                        row_data[headers[i]] = str(value).strip()
                if row_data:
                    data.append(row_data)

            if not data:
                raise UploadContactError(
                    code="NO_DATA_ROWS",
                    message="No data rows found after the header.",
                    fix="Add at least one row of contact data below the header (e.g. email addresses).",
                )

            return data
        except UploadContactError:
            raise
        except Exception as e:
            raise UploadContactError(
                code="PARSE_ERROR",
                message="We couldn't read the Excel file.",
                fix="Save the file as .xlsx or try exporting as CSV UTF-8 and upload the CSV instead.",
                detail=str(e),
            )

    def _parse_csv_bytes(self, file_contents: bytes) -> List[Dict]:
        text = _decode_csv(file_contents)
        stream = StringIO(text)
        try:
            csv_reader = csv.DictReader(stream)
            if csv_reader.fieldnames is None:
                raise UploadContactError(
                    code="NO_HEADERS",
                    message="No header row found.",
                    fix="Add a first line with column names (e.g. email, first_name, last_name).",
                )
            headers = [h.strip() for h in csv_reader.fieldnames if h and h.strip()]
            if not headers:
                raise UploadContactError(
                    code="NO_HEADERS",
                    message="Header row is empty or invalid.",
                    fix="Use a first row with column names. Download the example CSV for the expected format.",
                )

            data = []
            for row in csv_reader:
                row_data = {k.strip(): (v or "").strip() for k, v in row.items() if k and k.strip()}
                row_data = {k: v for k, v in row_data.items() if v}
                if row_data:
                    data.append(row_data)

            if not data:
                raise UploadContactError(
                    code="NO_DATA_ROWS",
                    message="No data rows found after the header.",
                    fix="Add at least one row of contact data (e.g. email addresses) below the header.",
                )

            return data
        except UploadContactError:
            raise
        except Exception as e:
            raise UploadContactError(
                code="PARSE_ERROR",
                message="We couldn't read the CSV file.",
                fix="Check that the file is valid CSV (comma-separated, with a header row). Try the example CSV.",
                detail=str(e),
            )

    def get_available_fields(self, data: List[Dict]) -> List[str]:
        """Get all unique fields from parsed data."""
        if not data:
            return []
        fields = set()
        for row in data:
            fields.update(row.keys())
        return sorted(list(fields))

    def map_contacts(
        self,
        user_id: str,
        contacts_data: List[Dict],
        field_mapping: Dict[str, str],
    ) -> List[Dict]:
        """Map Excel fields to contact fields."""
        contacts = []
        for row_data in contacts_data:
            contact = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "status": "pending",
                "created_at": datetime.now(timezone.utc),
                "custom_fields": {},
            }
            for db_field, excel_field in field_mapping.items():
                if excel_field and excel_field in row_data:
                    value = row_data[excel_field]
                    if db_field in ["email", "first_name", "last_name", "company", "industry"]:
                        contact[db_field] = value
                    else:
                        contact["custom_fields"][db_field] = value
            if "email" not in contact or not (contact.get("email") or "").strip():
                continue
            email_lower = (contact.get("email") or "").strip().lower()
            if any((c.get("email") or "").strip().lower() == email_lower for c in contacts):
                continue
            contacts.append(contact)
        return contacts
