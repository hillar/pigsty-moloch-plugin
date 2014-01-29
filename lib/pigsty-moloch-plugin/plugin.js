var debug = require('debug')('pigsty-example-plugin');
var PigstyPlugin = require('pigsty-plugin');

molochPlugin.prototype = new PigstyPlugin();
molochPlugin.prototype.constructor = PigstyPlugin;

function molochPlugin(options) {
  PigstyPlugin.call(this, options);
  this.options = options;
};

molochPlugin.prototype.configure = function(callback) {
  debug('Configure Plugin: pigsty-moloch-plugin');
};

molochPlugin.prototype.start = function(callback) {
  emit('ready');
};

molochPlugin.prototype.stop = function(callback) {
  emit('end');
};

molochPlugin.prototype.send = function(event) {
  debug(event);
};

module.exports = function(options) {
  return new molochPlugin(options);
};
