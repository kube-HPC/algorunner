FROM node:latest
MAINTAINER yehiyam@gmail.com
RUN apt update && apt install nano
RUN mkdir /sound-factory && npm install -g nodemon
COPY . /sound-factory/algorunner
WORKDIR /sound-factory/algorunner
CMD ["nodemon", "app.js"]