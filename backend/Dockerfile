FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HELIUM_DATA_DIR=/data

WORKDIR /app

# ML is enabled by default in the image. Set INSTALL_ML=0 for a small image that
# uses Helium's deterministic hash embeddings and blank spaCy fallback.
ARG INSTALL_ML=1
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu

COPY requirements.txt requirements-ml.txt ./
RUN pip install -r requirements.txt \
    && if [ "$INSTALL_ML" = "1" ]; then \
         pip install --index-url "$TORCH_INDEX_URL" torch \
         && pip install -r requirements-ml.txt \
         && python -m spacy download en_core_web_sm; \
       fi

COPY app ./app

RUN useradd --create-home --uid 10001 helium \
    && mkdir -p /data \
    && chown -R helium:helium /app /data

USER helium

EXPOSE 8000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
