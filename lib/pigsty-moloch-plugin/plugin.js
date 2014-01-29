var debug = require('debug')('pigsty-example-plugin');
var PigstyPlugin = require('pigsty-plugin');
var os = require('os');
var util = require('util');

molochPlugin.prototype = new PigstyPlugin();
molochPlugin.prototype.constructor = PigstyPlugin;

function molochPlugin(options) {
  PigstyPlugin.call(this, options);
  this.options = options;
  this.nodeName = os.hostname().split(".")[0]
};

molochPlugin.prototype.configure = function(callback) {
  debug('Configure Plugin: pigsty-moloch-plugin');
  var selfie = this;
  var iniParserLocation = 'iniparser';
  if (selfie.options.iniparser_module_location){
    iniParserLocation = selfie.options.iniparser_module_location;
  }
  try {
    var iniParser = require(iniParserLocation);
  } catch (e) {
    console.error("ERROR - Couldn't load iniparser. Location:"+iniParserLocation, e);
  }
  selfie.options.moloch = iniParser.parseSync(selfie.options.moloch_config_file_location); 
};

molochPlugin.prototype.getMolochOption = function (key, defaultValue) {
  var selfie = this;
  var node = selfie.nodeName;
  if (selfie.options.moloch[node] && selfie.options.moloch[node][key] !== undefined) {
    return selfie.options.moloch[node][key];
  }
  if (selfie.options.moloch[node] && selfie.options.moloch[node].nodeClass && selfie.options.moloch[selfie.options.moloch[node].nodeClass] && selfie.options.moloch[selfie.options.moloch[node].nodeClass][key]) {
    return selfie.options.moloch[selfie.options.moloch[node].nodeClass][key];
  }
  if (selfie.options.moloch["default"][key]) {
    return selfie.options.moloch["default"][key];
  }
  if (selfie.options.moloch[key]) {
    return selfie.options.moloch[key];
  }
  return defaultValue;
};


molochPlugin.prototype.start = function(callback) {

  if (this.options.min_free_memory) {
    var freemem = os.freemem();
    if (this.options.min_free_memory > freemem)
      console.error('Over the limit of minimal free memory. Limit:'+this.options.min_free_memory+' Free:'+freemem)
      # exit here ...

  }
  
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
