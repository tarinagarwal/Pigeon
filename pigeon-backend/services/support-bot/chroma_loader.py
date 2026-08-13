import json
import logging
import shutil
from json import JSONDecodeError
from pathlib import Path
from typing import List, Dict, Any

import chromadb
from chromadb.utils import embedding_functions


BASE_DIR = Path(__file__).parent
DATA_PATH = BASE_DIR / "data.json"
BLOGS_PATH = BASE_DIR / "blogs.json"
CHROMA_DIR = BASE_DIR / "chroma_db"
COLLECTION_NAME = "pigeon_support_blogs"

logger = logging.getLogger(__name__)


class DataLoadError(RuntimeError):
    """Raised when the knowledge base JSON cannot be loaded."""


def load_data(path: Path = DATA_PATH) -> List[Dict[str, Any]]:
    """Load the blog/support Q&A JSON dataset."""
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError as exc:
        msg = f"Knowledge base file not found at {path!s}."
        raise DataLoadError(msg) from exc
    except JSONDecodeError as exc:
        msg = f"Knowledge base file at {path!s} is not valid JSON."
        raise DataLoadError(msg) from exc


def load_blogs(path: Path = BLOGS_PATH) -> List[Dict[str, Any]]:
    """
    Load long-form blog articles from blogs.json.

    Only the `content` field is used as the retrievable text; other fields
    remain available in metadata for future use.
    """
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        # blogs.json is optional; if it's missing we simply skip blog content.
        logger.info("Optional blogs.json not found at %s; skipping blog articles.", path)
        return []
    except JSONDecodeError as exc:
        msg = f"blogs.json at {path!s} is not valid JSON."
        raise DataLoadError(msg) from exc


def get_client():
    """Create a persistent Chroma client, resetting corrupted DBs when needed."""
    CHROMA_DIR.mkdir(exist_ok=True)
    try:
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    except Exception as exc:
        # When the on-disk Chroma DB was created by an incompatible version,
        # the client can fail with errors like missing '_type'. In that case
        # we wipe the directory and start fresh from data.json.
        logger.warning("Failed to open Chroma DB at %s (%s). Resetting it.", CHROMA_DIR, exc)
        shutil.rmtree(CHROMA_DIR, ignore_errors=True)
        CHROMA_DIR.mkdir(exist_ok=True)
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    # Use a local sentence-transformer so no external API is required.
    embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name="all-MiniLM-L6-v2"
    )

    try:
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=embedding_fn,
            metadata={"description": "Pigeon support / blog Q&A content"},
        )
    except Exception as exc:
        # Older Chroma versions stored collection configuration without the new
        # `_type` field, which causes KeyError('_type') when newer clients try
        # to load them. When this happens we delete the on-disk DB and rebuild
        # from data.json.
        logger.warning(
            "Failed to open Chroma collection %s (%s). Resetting DB at %s.",
            COLLECTION_NAME,
            exc,
            CHROMA_DIR,
        )
        shutil.rmtree(CHROMA_DIR, ignore_errors=True)
        CHROMA_DIR.mkdir(exist_ok=True)
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=embedding_fn,
            metadata={"description": "Pigeon support / blog Q&A content"},
        )
    return client, collection


def build_collection(force_rebuild: bool = False):
    """
    Ingest the JSON Q&A data into ChromaDB.

    Each question variant becomes a document with the same answer,
    so retrieval works well even if the user phrasing matches any variant.
    """
    client, collection = get_client()

    if force_rebuild:
        try:
            client.delete_collection(COLLECTION_NAME)
        except Exception as exc:  # Chroma can raise if collection does not exist
            logger.warning("Failed to delete existing collection %s: %s", COLLECTION_NAME, exc)
        _, collection = get_client()

    existing_count = collection.count()
    if existing_count > 0 and not force_rebuild:
        return collection

    # FAQ-style Q&A entries from data.json
    faq_records = load_data()
    # Long-form articles from blogs.json (content-only)
    blog_records = load_blogs()

    ids: List[str] = []
    documents: List[str] = []
    metadatas: List[Dict[str, Any]] = []

    # Ingest FAQ Q&A where each question variant becomes its own document
    for item in faq_records:
        slug = item.get("slug", "")
        questions: List[str] = item.get("questions", [])
        answer: str = item.get("answer", "")

        for idx, q in enumerate(questions):
            doc_id = f"{slug}:{idx}"
            ids.append(doc_id)
            documents.append(q + "\n\n" + answer)
            metadatas.append(
                {
                    "slug": slug,
                    "question": q,
                    "source": "faq",
                }
            )

    # Ingest blog articles where the embedding text is only the `content` field
    for blog in blog_records:
        slug = blog.get("slug", "")
        content: str = blog.get("content", "")
        if not content:
            continue

        doc_id = f"blog:{slug or len(ids)}"
        ids.append(doc_id)
        documents.append(content)
        metadatas.append(
            {
                "slug": slug,
                "source": "blog",
            }
        )

    if ids:
        try:
            collection.add(ids=ids, documents=documents, metadatas=metadatas)
        except Exception as exc:
            logger.error("Failed to add documents to Chroma collection: %s", exc)
            raise

    return collection


def query_knowledge_base(query: str, top_k: int = 3):
    """
    Query the ChromaDB collection and return matches with scores.

    The distance is cosine distance; lower is better. Callers can
    apply their own threshold to decide if the query is in-domain.
    """
    # Ensure the collection is built from data.json at least once.
    collection = build_collection(force_rebuild=False)
    results = collection.query(query_texts=[query], n_results=top_k)
    return results


if __name__ == "__main__":
    print("Building ChromaDB collection from data.json...")
    coll = build_collection(force_rebuild=False)
    print(f"Collection '{COLLECTION_NAME}' ready with {coll.count()} items.")
