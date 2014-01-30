var debug = require('debug')('pigsty-moloch-plugin');
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


molochPlugin.prototype.getMolochOption = function (key, defaultValue) {
  var node = this.nodeName;
  var options = this.options.moloch
  if (options[node] && options[node][key] !== undefined) {
    return options[node][key];
  }
  if (options[node] && options[node].nodeClass && options[options[node].nodeClass] && options[options[node].nodeClass][key]) {
    return options[options[node].nodeClass][key];
  }
  if (options["default"][key]) {
    return options["default"][key];
  }
  if (options[key]) {
    return options[key];
  }
  return defaultValue;
};


molochPlugin.prototype.start = function(callback) {

  if (this.options.min_free_memory) {
    var freemem = os.freemem();
    if (this.options.min_free_memory > freemem)
      console.error('Over the limit of minimal free memory. Limit:'+this.options.min_free_memory+' Free:'+freemem);

      process.exit(1); // or should we emit error ?

  }
  //todo check memory max limit...

  var iniParserLocation = 'iniparser'; //default to npm install iniparser -g
  if (this.options.iniparser_module_location){
    iniParserLocation = this.options.iniparser_module_location;
  }
  try {
    var iniParser = require(iniParserLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  this.options.moloch = iniParser.parseSync(this.options.moloch_config_file_location); 
  if (this.options.moloch["default"] === undefined) {
    this.emit('error', 'default setcion is missing in ' + this.options.moloch_config_file_location);
    return;
  }

  var tmp_escInfo = this.getMolochOption("elasticsearch");
  if (tmp_escInfo) {
     var escInfo = tmp_escInfo.split(':');
  } else {
    this.emit('error','elasticsearch data missing');
    return;
  }

  var asyncLocation = 'async'; //default to npm install async -g
  if (this.options.async_module_location){
    asyncLocation = this.options.async_module_location;
  }
  try {
    var this.async = require(asyncLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  var KAALocation = 'keep-alive-agent'; //default to npm install keep-alive-agent -g
  if (this.options.keepaliveagent_module_location){
    KAALocation = this.options.keepaliveagent_module_location;
  }
  try {
    var this.KAA = require(KAALocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  if (this.options.db_module_location){
    var dbLocation = this.options.db_module_location;
  } else {
    this.emit('error', 'missing db module location in your config');
    return;
  }
  try {
    var this.Db = require(dbLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }
  // ... 


  
  this.emit('ready');
};


molochPlugin.prototype.stop = function(callback) {
  this.emit('end');
};


molochPlugin.prototype.send = function(event) {
  debug(event);
};


module.exports = function(options) {
  return new molochPlugin(options);
};
