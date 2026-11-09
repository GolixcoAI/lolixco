FROM public.ecr.aws/docker/library/python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PIP_DISABLE_PIP_VERSION_CHECK=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && test ! -e /usr/bin/tiffcrop \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/local-dna/requirements.txt /tmp/analyzer-requirements.txt
COPY scripts/aws/requirements.txt /tmp/aws-requirements.txt
RUN pip install --no-cache-dir -r /tmp/analyzer-requirements.txt -r /tmp/aws-requirements.txt awslambdaric
COPY scripts/local-dna/ /app/scripts/local-dna/
COPY scripts/edit-dna/ /app/scripts/edit-dna/
COPY server/production/ /app/server/production/
RUN NUMBA_CPU_NAME=generic NUMBA_CACHE_DIR=/opt/numba-cache python /app/server/production/warm_cache.py
ENV PYTHONPATH=/app/server/production HOME=/tmp NUMBA_CACHE_DIR=/tmp/numba LOLIXCO_DNA_STATE_PARENT=/tmp
ENTRYPOINT ["/usr/local/bin/python", "-m", "awslambdaric"]
CMD ["worker.handler"]
