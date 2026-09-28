FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY app ./app
COPY web ./web

# Session file and config live here. Mount a volume or the login is lost on
# every restart: docker run -v forwarder-data:/data ...
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=8000
VOLUME ["/data"]
EXPOSE 8000

CMD ["python", "main.py"]
