FROM node:20-bookworm
LABEL maintainer="Kirdunqt"

# Install LibreOffice for conversion
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice-common libreoffice-base libreoffice-calc libreoffice-impress libreoffice-writer fonts-liberation fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js script.js index.html style.css ./
RUN mkdir -p uploads output

EXPOSE 3000

CMD ["node", "server.js"]
