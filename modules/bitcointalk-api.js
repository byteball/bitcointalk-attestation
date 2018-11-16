const request = require('request');
const cheerio = require('cheerio');

exports.Initialize = (config) => {
  return {

  };
};

exports.getLoginURL = (state) => {

};

exports.me = () => {
  return getJQueryResponse('')
    .then(($) => {

    });
};

function getJQueryResponse(url) {
  return requestResponseAsync(url)
    .then((body) => {
      return cheerio.load(body);
    });
}

function requestResponseAsync(url) {
  return new Promise((resolve, reject) => {
    request(url, (error, response, body) => {
      if (error) {
        return reject(error);
      }

      resolve(body);
    });
  });
}
