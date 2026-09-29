# syntax=docker/dockerfile:1
# Runs the model-written python-pptx programs. Deliberately holds no secrets and
# sits on an internal-only network (see docker-compose.yml).
FROM python:3.12-slim
WORKDIR /src
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd -r -u 10001 runner
COPY app.py .
USER runner
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
