/**
 * @alaminnna/ica-unofficial — core/proxy
 * 
 * RESPONSIBILITY: proxy URL parsing and axios agent building (http/https/socks).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        socks-proxy-agent (optional)
 * MUST NOT:       never log proxy passwords
 * 
 * DEBUG: when connections fail behind a proxy, start looking here — agent construction
 */

'use strict';

const DEFAULT_PORTS = { http: 8080, https: 8080, socks5: 1080, socks5h: 1080 };

function parseProxy(url) {
  if (!url) {
    return null;
  }
  const parsed = parseProxyInner(String(url).trim());
  return parsed;
}

function parseProxyInner(text) {
  const schemeSplit = text.split('://');
  if (schemeSplit.length !== 2) {
    throw new Error('@alaminnna/ica-unofficial: invalid proxy URL (missing ://)');
  }
  const protocol = schemeSplit[0].toLowerCase();
  if (!DEFAULT_PORTS[protocol]) {
    throw new Error('@alaminnna/ica-unofficial: unsupported proxy protocol ' + protocol);
  }
  let rest = schemeSplit[1];
  let username = '';
  let password = '';
  const atIndex = rest.lastIndexOf('@');
  if (atIndex !== -1) {
    const authPart = rest.slice(0, atIndex);
    rest = rest.slice(atIndex + 1);
    const colonIndex = authPart.indexOf(':');
    if (colonIndex === -1) {
      username = decodeURIComponent(authPart);
    } else {
      username = decodeURIComponent(authPart.slice(0, colonIndex));
      password = decodeURIComponent(authPart.slice(colonIndex + 1));
    }
  }
  const hostPort = rest.split('/')[0];
  let host = hostPort;
  let port = DEFAULT_PORTS[protocol];
  if (hostPort.charAt(0) === '[') {
    const close = hostPort.indexOf(']');
    if (close === -1) {
      throw new Error('@alaminnna/ica-unofficial: invalid proxy URL (malformed IPv6 host)');
    }
    host = hostPort.slice(1, close);
    const tail = hostPort.slice(close + 1);
    if (tail) {
      if (tail.charAt(0) !== ':') {
        throw new Error('@alaminnna/ica-unofficial: invalid proxy URL (bad port)');
      }
      port = Number(tail.slice(1));
    }
  } else {
    const colonIndex = hostPort.lastIndexOf(':');
    if (colonIndex !== -1) {
      host = hostPort.slice(0, colonIndex);
      port = Number(hostPort.slice(colonIndex + 1));
    }
  }
  if (!host) {
    throw new Error('@alaminnna/ica-unofficial: invalid proxy URL (missing host)');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('@alaminnna/ica-unofficial: invalid proxy URL (bad port)');
  }
  return { protocol, host, port, username, password };
}

function maskProxy(url) {
  if (!url) {
    return url;
  }
  return String(url).replace(/(\/\/[^:]+:)[^@]+(@)/, '$1***$2');
}

function buildProxyAgents(parsed) {
  if (!parsed) {
    return null;
  }
  if (parsed.protocol === 'http' || parsed.protocol === 'https') {
    const proxy = { host: parsed.host, port: parsed.port };
    if (parsed.username) {
      proxy.auth = { username: parsed.username, password: parsed.password };
    }
    return { axiosProxy: proxy };
  }
  let agentModule = null;
  try {
    require.resolve('socks-proxy-agent');
    agentModule = require('socks-proxy-agent');
  } catch (err) {
    throw new Error('@alaminnna/ica-unofficial: socks proxy needs socks-proxy-agent: npm install socks-proxy-agent');
  }
  const source = (parsed.username ? parsed.username + ':' + parsed.password + '@' : '') + parsed.host + ':' + parsed.port;
  const Agent = agentModule.SocksProxyAgent || agentModule;
  const agent = new Agent(parsed.protocol + '://' + source);
  return { httpAgent: agent, httpsAgent: agent };
}

module.exports = { parseProxy, maskProxy, buildProxyAgents };