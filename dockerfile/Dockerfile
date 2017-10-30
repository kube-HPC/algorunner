FROM node:latest
MAINTAINER yehiyam@gmail.com

RUN mkdir /sound-factory && npm install -g nodemon
COPY . /sound-factory/algorunner
WORKDIR /sound-factory/algorunner
CMD ["nodemon", "app.js"]