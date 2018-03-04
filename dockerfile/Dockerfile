ARG BASE_PRIVATE_REGISTRY=""
FROM ${BASE_PRIVATE_REGISTRY}hkube/base-node:v1.0.0
LABEL maintainer="yehiyam@gmail.com"
RUN mkdir /sound-factory
COPY . /sound-factory/algorunner
WORKDIR /sound-factory/algorunner
CMD ["node", "app.js"]