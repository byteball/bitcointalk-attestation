const conf = require('byteballcore/conf');
const request = require('request');
const SocksProxyAgent = require('socks-proxy-agent');
const cheerio = require('cheerio');

const regexp = /https:\/\/bitcointalk\.org\/index\.php\?.*(?:u=(.+);).*/g;
const arrRanks = Object.keys(conf.listRankRewardsInUsd)
  .map((rank) => rank.toLowerCase());

function StructureChangedError(message, userId) {
  this.name = 'StructureChangedError';
  this.message = `html structure was changed: ${message}, ${userId}`;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = (new Error()).stack;
  }
}
StructureChangedError.prototype = Object.create(Error.prototype);
StructureChangedError.prototype.constructor = StructureChangedError;

exports.checkProfileUserId = (text) => {
  const res = regexp.exec(text);
  if (!res || res.length < 2) {
    return;
  }

  console.log(' api checkProfileUserId', text); // eslint-disable-line no-console
  const userId = Number(res[1]);
  if (Number.isNaN(userId) || !userId) {
    return;
  }

  return userId;
};

exports.getLoginURL = (bbAddress) => {
  return `${conf.webSiteUrl}/${encodeURIComponent(bbAddress)}`;
};

exports.getProfileData = (userId, bbAddress) => {
  return getJQueryResponse(`https://bitcointalk.org/index.php?action=profile;u=${userId};wap`)
    .then(($) => {
      const tablesHolders = $('.windowbg');
      if (!tablesHolders || tablesHolders.length !== 2) {
        throw new StructureChangedError('tablesHolders', userId);
      }
      const tableData = tablesHolders.children().first().children();
      const tableRows = tableData.children();
      if (!tableRows || !tableRows.length) {
        throw new StructureChangedError('tableRows', userId);
      }

      const link = exports.getLoginURL(bbAddress);
      if (!checkLink(tableRows, link)) {
        throw new Error(`link ${link} not found`);
      }

      const name = rowsGetValueByKey(tableRows, 'name');
      if (!name) {
        throw new StructureChangedError('name', userId);
      }
      const posts = rowsGetValueByKey(tableRows, 'posts');
      if (!posts) {
        throw new StructureChangedError('posts', userId);
      }
      console.error('row posts', posts);
      const activity = rowsGetValueByKey(tableRows, 'activity');
      if (!activity) {
        throw new StructureChangedError('activity', userId);
      }
      console.error('row activity', activity);
      let rank = rowsGetValueByKey(tableRows, 'rank');
      if (!rank) {
        throw new StructureChangedError('rank', userId);
      }
      rank = rank.toLowerCase();
      console.error('row rank', rank);
      const rankIndex = getRankIndex(rank);
      if (rankIndex < 0) {
        throw new Error(`undefined rank: ${rank}, ${userId}`);
      }
      const data = {};

      data.name = name;
      data.rank = rank;
      data.rankIndex = rankIndex;
      data.posts = Number(posts);
      data.activity = Number(activity);
      
      return data;
    });
};

function checkLink(rows, link) {
  if (checkLinkWebsiteText(rowsGetValueByKey(rows, 'website'), link)) {
    return true;
  }
  
  const signatureEl = rows.find('.signature');
  if (!signatureEl) {
    return false;
  }
  const text = signatureEl.text();
  if (!text) {
    return false;
  }

  return text.includes(link);
}

function checkLinkWebsiteText(text, link) {
  if (!text) {
    return false;
  }
  console.error('checkLinkWebsiteText', text, link);
  return text.includes(link);
}

function rowsGetValueByIndex(rows, index) {
  if (rows.length <= index) {
    return null;
  }
  const elsTd = rows.eq(index).children();
  if (elsTd.length < 2) {
    return null;
  }
  const res = elsTd.eq(1).text();
  if (!res) {
    return null;
  }
  return res.trim();
}

function rowsGetValueByTitle(rows, title, arrIndices) {
  for (let i = 0; i < arrIndices.length; i++) {
    const index = arrIndices[i];
    if (rows.length <= index) {
      return null;
    }
    const elsTd = rows.eq(index).children();
    if (elsTd.length < 2) {
      return null;
    }
    const rowTitle = elsTd.eq(0).text().trim();
    if (rowTitle !== title) {
      console.error('row not equal', rowTitle, title, index);
      continue;
    }

    const res = elsTd.eq(1).html();
    if (!res) {
      return null;
    }
    return res.trim();
  }
  return null;
}

const tableRowKeyIndexMap = {
  'name': 0,
  'posts': {
    title: 'Posts:',
    indices: [1, 2],
  },
  'activity': {
    title: 'Activity:',
    indices: [2, 3],
  },
  'rank': {
    title: 'Position:',
    indices: [4, 5],
  },
  'website': {
    title: 'Website:',
    indices: [13, 14],
  },
};

function rowsGetValueByKey(rows, key) {
  if (!(key in tableRowKeyIndexMap)) {
    throw new Error('undefined key');
  }
  const value = tableRowKeyIndexMap[key];
  if (typeof value === 'object') {
    return rowsGetValueByTitle(rows, value.title, value.indices);
  }
  return rowsGetValueByIndex(rows, value);
}

function getRankIndex(rank) {
  return arrRanks.indexOf(rank);
}

function getJQueryResponse(url) {
  return requestResponseAsync(url)
    .then((body) => {
      return cheerio.load(body);
    });
}

function requestResponseAsync(url) {
  return new Promise((resolve, reject) => {
    makeRequest(url, (error, response, body) => {
      if (error) {
        return reject(error);
      }

      resolve(body);
    });
  });
}

function makeRequest(endpoint, cb) {
  const opts = getRequestOptions(endpoint);
  request(opts, cb);
}

function getRequestOptions(endpoint) {
  if (conf.socksHost) {
    // SOCKS proxy to connect to
    const proxy = `socks://${conf.socksHost}:${conf.socksPort}`;

    // HTTP uri for the proxy to connect to
    const opts = {
      uri: endpoint,
    };
    
    // create an instance of the `SocksProxyAgent` class with the proxy server information
    // NOTE: the `true` second argument! Means to use TLS encryption on the socket
    const agent = new SocksProxyAgent(proxy, true);
    opts.agent = agent;

    return opts;
  }

  return {
    uri: endpoint,
  };
}
