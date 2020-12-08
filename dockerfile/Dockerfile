ARG BASE_PRIVATE_REGISTRY=""
FROM ${BASE_PRIVATE_REGISTRY}node:14.5.0 as install
ADD ./package-lock.json ./package.json /hkube/algorunner/
WORKDIR /hkube/algorunner
RUN npm ci

FROM ${BASE_PRIVATE_REGISTRY}hkube/base-node:v1.2.0
LABEL maintainer="yehiyam@gmail.com"
ADD . /hkube/algorunner
COPY --from=install /hkube/algorunner/node_modules /hkube/algorunner/node_modules
WORKDIR /hkube/algorunner
CMD ["node", "app.js"]