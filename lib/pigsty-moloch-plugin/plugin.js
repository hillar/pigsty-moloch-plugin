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
    console.error("ERROR - Couldn't load iniparser. Location:"+iniParserLocation, e);
    this.emit('error',e)
    //process.exit(1);
  }
  this.options.moloch = iniParser.parseSync(this.options.moloch_config_file_location); 
  
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
