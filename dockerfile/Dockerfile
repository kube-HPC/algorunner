FROM node:8
MAINTAINER yehiyam@gmail.com
RUN apt update && apt install nano
RUN mkdir /sound-factory
COPY . /sound-factory/algorunner
WORKDIR /sound-factory/algorunner
CMD ["node", "app.js"]