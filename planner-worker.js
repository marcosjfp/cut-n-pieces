'use strict';
importScripts('optimizer.js');
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: Cutwise.optimize(data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
