FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PDM_CHECK_UPDATE=false

WORKDIR /app

RUN pip install --no-cache-dir "pdm>=2.25,<3"

# Install locked production dependencies before copying application code for better caching.
COPY pyproject.toml pdm.lock ./
RUN pdm sync --prod --no-editable

COPY app ./app
COPY run.py ./run.py

RUN mkdir -p /app/data /app/backups \
    && chown -R 10001:10001 /app

ENV HOST=0.0.0.0 \
    PORT=8000 \
    LEGKYI_DATA_DIR=/app/data

USER 10001:10001

EXPOSE 8000

CMD ["pdm", "run", "python", "run.py"]
