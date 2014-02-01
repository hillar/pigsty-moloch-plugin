var debug = require('debug')('pigsty-moloch-plugin');
var PigstyPlugin = require('pigsty-plugin');
var os = require('os');
var util = require('util');


function ntoa(ipl) {
    return ((ipl >>> 24) + '.' +
        (ipl >> 16 & 255) + '.' +
        (ipl >> 8 & 255) + '.' +
        (ipl & 255));
};


molochPlugin.prototype = new PigstyPlugin();
molochPlugin.prototype.constructor = PigstyPlugin;
function molochPlugin(options) {
  PigstyPlugin.call(this, options);
  this.options = options;
  this.nodeName = os.hostname().split(".")[0];
  if (!this.options.eventQueueMaxSize) {
    this.options.eventQueueMaxSize = 1024;
  }
  if (!this.options.maxHeapSize){
    this.options.maxHeapSize = 1073741824/10;
  }
  if (!this.options.tag_prefix) {
    this.options.tag_prefix = 'suricata';
  }

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
    if (this.options.min_free_memory > freemem) {
      this.emit('error','Over the limit of minimal free memory. Limit:'+this.options.min_free_memory+' Free:'+freemem);
      return;
    }
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
    this.async = require(asyncLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  var KAALocation = 'keep-alive-agent'; //default to npm install keep-alive-agent -g
  if (this.options.keepaliveagent_module_location){
    KAALocation = this.options.keepaliveagent_module_location;
  }
  try {
    this.KAA = require(KAALocation);
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
    this.Db = require(dbLocation);
  } catch (e) {
    this.emit('error',e);
    return;
  }

  this.esHttpAgent = new this.KAA({maxSockets: 20}); // todo options here..
  this.Db.initialize({
        host: escInfo[0],
        port: escInfo[1],
        nodeName: this.nodeName,
        agent: this.esHttpAgent,
        dontMapTags: this.getMolochOption("multiES", false)
    });

  this.options.tcpSaveTimeout = this.getMolochOption('tcpSaveTimeout',3);
  this.eventQueue = [];
  this.eventsNotFound = [];
  this.tagsQueue = {};

  this.eventCount = 0;
  this.eventCountIN = 0;

  this.inPost = 0;
  if (this.options.print_stats){
    this.eventCountINLast = 0;
    this.eventCountLast = 0;
    var _this = this;
    this.timer = setInterval(function () {
      var now = new Date;
      var paused = '';
      if ( _this.paused ) { paused = ' state: paused'; }
      var lastMinuteCountIN = _this.eventCountIN - _this.eventCountINLast;
      var lastMinuteRateIN = lastMinuteCountIN / 10;
      var lastMinuteCount = _this.eventCount - _this.eventCountLast;
      var dropedEventCount = lastMinuteCountIN - lastMinuteCount;
      console.log('' + now + 'in post:'+_this.inPost + ' in queue:'+_this.eventQueue.length + ' not found:'+_this.eventsNotFound.length+' in total: '+_this.eventCountIN+' last minute:'+lastMinuteCountIN+' rate:'+lastMinuteRateIN+'eps'+' droped:'+dropedEventCount+paused);
      _this.eventCountINLast = _this.eventCountIN;
      _this.eventCountLast = _this.eventCount;
    }, 10 * 1000);
  }
  this.emit('ready');
};


molochPlugin.prototype.close = function(callback) {
  //flusth queue ...
  for (var i = 0; i < (this.eventQueue.length - 1); i++) {
    this.post(this.eventQueue.pop());
    debug('flushing: ' + this.eventQueue.length);
  }
  this.eventQueue = [];
  this.tagsQueue = {};
  this.emit('end');
};

molochPlugin.prototype.getUnixTime = function () {
    return Math.floor(new Date().getTime() / 1000);
};

molochPlugin.prototype.send = function(event) {
  var _event = {}; 
  this.eventCountIN += 1;
  if (event && event.event && event.event.event_second) {
    _event.time = event.event.event_second;
    _event.srcIP = event.event.source_ip;
    _event.srcPort = event.event.source_port;
    _event.dstIP = event.event.destination_ip;
    _event.dstPort = event.event.dest_port;
    _event.tags = [];
    //todo options for tags...
    _event.tags.push(this.options.tag_prefix + '_severity_' + event.event.classification.severity);
    _event.tags.push(this.options.tag_prefix + '_classification_' + event.event.classification.name);
    _event.tags.push(this.options.tag_prefix + '_signatureID_' + event.event.signature.id);
    _event.tags.push(this.options.tag_prefix + '_signature_' + event.event.signature.name);

    this.eventCount += 1;

    if (this.paused){
      this.eventQueue.push(_event);
      debug('emited full, but still getting events...');
    } else {
      var needPause = false;

      if (this.eventQueue.length > this.options.eventQueueMaxSize) {
        needPause = true;
        debug('queue full');
      }

      var freemem = os.freemem();
      if (this.options.min_free_memory > freemem) {
          needPause = true;
          debug('memory almost full' + freemem);
      }

      var memusage = process.memoryUsage();
      if (memusage.heapUsed > (this.options.maxHeapSize)) {
        needPause = true;
        debug('heap full ' + memusage.heapUsed);
      }

      var diff = 1;
      var now = this.getUnixTime();
      if ( (now - this.options.tcpSaveTimeout) < _event.endTime ) {
        diff = now - this.options.tcpSaveTimeout - _event.endTime ;
        needPause = true;
        debug('need to wait moloch saves session ' + now + ' event time: ' + _event.endTime + ' diff:' + diff);
      }
      if (this.inPost > 32) {
        needPause = true;
        debug('post full');

      }

      if (needPause){
        this.emit('full');
        this.eventQueue.push(_event);
        var _this = this;
        this.paused = setInterval(function () {
                      debug('flushing after pause: ' + _this.eventQueue.length);
                      for (var i = 0; i < (_this.eventQueue.length - 1); i++) {
                        _this.post(_this.eventQueue.pop());
                      }
                      clearInterval(_this.paused);
                      _this.paused = null;
                      _this.emit('ok');
                  }, (diff * 1000)+1000);
      } else {

        this.post(_event);
      
      }
    }
  }
};


//helper funcs for post
molochPlugin.prototype.getTagIdFromMolochDB = function(tag){
  var _this = this;
  return this.Db.tagNameToId(tag, function (tagid) {
            if (tagid === -1) {
                tagid = _this.Db.createTag(tag,function(tagid) {return tagid;});
            } 
            return tagid;
          });
}

molochPlugin.prototype.getTagId = function(tag){
    if (this.tagsQueue[tag]){
      return this.tagsQueue[tag];
    } else {
      var id = this.getTagIdFromMolochDB(tag);
      this.tagsQueue[tag] = id;
      return id;
    }
  }

molochPlugin.prototype.getSessionIDFromMolochDB = function(time,srcIP,srcPort,dstIP,dstPort,cb){
  var indices = 'sessions-140201'; // TODO
  var err;
  var query = {
               "from":0,
               "size":1,
               "query":{
                  "filtered":{
                     "query":[ 
                              {"range":{"fp":{"lte":time}}},
                              {"range":{"lp":{"gte":time}}}
                            ]
                     },
                     {"filter":{
                        "bool":{
                           "must":[
                                  {"term":{"a1":srcIP}},
                                  {"term":{"p1":''+srcPort}},
                                  {"term":{"a2":dstIP}},
                                  {"term":{"p2":''+dstPort}}
                                  ]
                            }
                         }
                      }
                   }
                }

  this.Db.searchPrimary(indices, 'session', query, function(err, result) {
          if (err || result.error) {
            console.log("ERROR - Could not fetch list of sessions.  Err: ", err,  " Result: ", result, "query:", query);
            return cb(-1);
          }
          return cb(result.hits.hits);
          });
  }

molochPlugin.prototype.saveTags2Session = function(sessionId,tagIDs){
    return true;
  }

molochPlugin.prototype.post = function(data) {
  this.inPost += 1;
  var _this = this;
  this.getSessionIDFromMolochDB(data.time, data.srcIP, data.srcPort, data.dstIP, data.dstPort, function(sessions){
    if ( sessions.length > 0 ){
      var sessionId = -1;
      for (var j = 0; i < (sessions.length - 1); i++) {
           console.log(data.time, sessions[i]._source.fp, sessions[i]._source.lp)
      }
      
      var tagIDs = [];
      for (var i = 0; i < (data.tags.length - 1); i++) {
        tagIDs.push(_this.getTagId(data.tags[i])); 
      }
      var ok = _this.saveTags2Session(sessionId,tagIDs);
      if (!ok) {
        console.error('failed session tagging ;(')
      }
    } else {
      _this.eventsNotFound.push(data);
      //TODO...
    }
    this.inPost -= 1;
  });
  if (this.eventCount > 8) process.exit(1);

};


module.exports = function(options) {
  return new molochPlugin(options);
};
