# Production Dockerfile for Pigeon backend (FastAPI)
FROM python:3.12-slim

WORKDIR /app

# System deps (e.g. for cryptography)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
# sentence-transformers requires torch. The default PyPI wheel bundles the CUDA
# runtime (~3.5GB of nvidia-* packages) which this image never uses — the support
# bot embeds on CPU. Install the CPU-only build first so the resolver is already
# satisfied when requirements.txt is processed.
RUN pip install --no-cache-dir --timeout 120 --retries 10 \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==2.4.1

RUN pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt

# Application code
COPY . .

# Non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
ENV PORT=8000

# Run with uvicorn; host 0.0.0.0 for container networking
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
