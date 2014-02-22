var debug = require("debug")("pigsty-moloch-plugin");
var PigstyPlugin = require("pigsty-plugin");
var os = require("os");
var HashTable = require("hashtable");

if ( !global.logger ) {
  var NodeSyslogLoggerSimple = require("node-syslog-logger-simple");
  global.logger = new NodeSyslogLoggerSimple({"level":6});
}

/*
function ntoa(ipl) {
  return ((ipl >>> 24) + "." +
          (ipl >> 16 & 255) + "." +
          (ipl >> 8 & 255) + "." +
          (ipl & 255));
}
*/
function twoDigitString(value) {
  return (value < 10) ? ("0" + value) : value.toString();
}

function spaces(count){
  var space = "";
  for (var i=0; i < count; i++){
    space += " ";
  }
  return space;
}

function human(int,power){  //does -H ;)
  var _power = power || 1024;
  Math.log10 = function(n) {
      return (Math.log(n)) / (Math.log(10));
  };
  var units = ["", "K", "M", "G", "T","P"];
  var digit = ~~(Math.log10(int)/Math.log10(_power));
  return ~~(int/Math.pow(_power, digit)) + "" + units[digit];
}


molochPlugin.prototype = new PigstyPlugin();
molochPlugin.prototype.constructor = PigstyPlugin;
function molochPlugin(options) {
  PigstyPlugin.call(this, options);
  this.options = options;
}

// helper to get options from moloch config

molochPlugin.prototype.getMolochOption = function (key, defaultValue) {
  var node = this.nodeName;
  var options = this.options.moloch;
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
  this.nodeName = os.hostname().split(".")[0];
  if (!this.options.eventQueueMaxSize) {
    this.options.eventQueueMaxSize = 128;
  }
  if (!this.options.maxHeapSize){
    this.options.maxHeapSize = 1073741824*10;
  }
  if (!this.options.minFreeMemory){
    this.options.minFreeMemory = 1073741824/10;
  }
  if (!this.options.tagPrefix) {
    this.options.tagPrefix = "unified2";
  }
  if (this.options.minFreeMemory) {
    var freemem = os.freemem();
    if (this.options.minFreeMemory > freemem) {
      logger.error("msg=\"Over the limit of minimal free memory\"; limit="+this.options.minFreeMemory+"; free_memory="+freemem);
      this.emit("error","Over the limit of minimal free memory. Limit:"+this.options.minFreeMemory+" Free:"+freemem);
      return;
    }
  }
  if (this.options.maxHeapSize) {
    var memusage = process.memoryUsage();
    if (memusage.heapUsed > (this.options.maxHeapSize)) {
      logger.error("msg=\"Over the limit of maximal heap memory\"; limit=" + this.options.maxHeapSize+"; heap_memory="+memusage.heapUsed);
      this.emit("error","Over the limit of maximal heap memory. Limit" + this.options.maxHeapSize);
      return;
    }
  }
  if (!this.options.molochConfigFileLocation){
    logger.error("msg=\"moloch config file location is not defined, please add it to pigsty config moloch plugin section molochConfigFileLocation\";");
    this.emit("error","moloch config file location is not defined, please add it to pigsty config moloch plugin section molochConfigFileLocation");
    return;
  }

  if (!this.options.iniparserModuleLocation){
    this.options.iniparserModuleLocation = "iniparser";
  }
  try {
    var iniParser = require(this.options.iniparserModuleLocation);
  } catch (e) {
    logger.error("msg=\"" + e + "\";");
    this.emit("error",e);
    return;
  }
  try {
    this.options.moloch = iniParser.parseSync(this.options.molochConfigFileLocation); 
  } catch (e) {
    logger.error("msg=\"cant load moloch config file "+this.options.molochConfigFileLocation+"\";");
    this.emit("error","cant load moloch config file "+this.options.molochConfigFileLocation);
    return;
  }
  if (this.options.moloch["default"] === undefined) {
    logger.error("msg=\"default setcion is missing in "+this.options.molochConfigFileLocation+"\";");
    this.emit("error", "default setcion is missing in " + this.options.molochConfigFileLocation);
    return;
  }

  var tmp_escInfo = this.getMolochOption("elasticsearch");
  if (tmp_escInfo) {
     var escInfo = tmp_escInfo.split(":");
  } else {
    logger.error("msg=\"elasticsearch data missing\";");
    this.emit("error","elasticsearch data missing");
    return;
  }

  if (!this.options.asyncModuleLocation){
    this.options.asyncModuleLocation = "async";
  }
  try {
    this.async = require(this.options.asyncModuleLocation);
  } catch (e) {
    logger.error("msg=\"" + e + "\";");
    this.emit("error",e);
    return;
  }

  if (!this.options.keepaliveagentModuleLocation){
    this.options.keepaliveagentModuleLocation = "keep-alive-agent";
  }
  try {
    var KAA = require(this.options.keepaliveagentModuleLocation);
  } catch (e) {
    logger.error("msg=\"" + e + "\";");
    this.emit("error",e);
    return;
  }

  if (!this.options.dbModuleLocation){
    logger.error("msg=\"missing db module location in your config\"");
    this.emit("error", "missing db module location in your config");
    return;
  }
  try {
    this.Db = require(this.options.dbModuleLocation);
  } catch (e) {
    logger.error("msg=\"" + e + "\";");
    this.emit("error",e);
    return;
  }
  if ( !this.options.maxKeepAliveSockets ) {
    this.options.maxKeepAliveSockets = 20;
  }
  this.Db.initialize({
        host: escInfo[0],
        port: escInfo[1],
        nodeName: this.nodeName,
        agent: new KAA({maxSockets: this.options.maxKeepAliveSockets }),
        dontMapTags: this.getMolochOption("multiES", false)
    });

  // todo check ela flush time from template
  // curl http://localhost:9200/_template/template_1\?pretty 
  var _this = this;
  this.Db.status("sessions-*", function (err, status) {
    if ( err ) {
      logger.error("msg=\"" + err + "\";");
      this.emit("error", err);
      return;
    }
    if ( status.error ) {
        logger.error("msg=\"" + status.error + "\";");
        this.emit("error", status.error);
        return;
    }
    _this.dbStatustatus = status;
  });

  this.options.tcpSaveTimeout = parseInt(this.getMolochOption("tcpSaveTimeout",3));
  this.eventQueue = [];
  this.eventsNotFound = [];
  this.tagsQueue = new HashTable();
  this.lastMissingIndice = "";
  this.searchTook = 10;
  this.updateTook = 10;
  this.inPost = 0;

  this.stats = [];
  this.stats["eventsIn"] = 0;
  this.stats["eventsDropped"] = 0;
  this.stats["eventsDeduped"] = 0;
  this.stats["eventsPosted"] = 0;
  this.stats["sessionsFounded"] = 0;
  this.stats["sessionsNotFound"] = 0;
  this.stats["sessionsTagged"] = 0;
  this.stats["sessionsTagFailed"] = 0;
  this.stats["waitingForSessionShort"] = 0;
  this.stats["waitingForSessionLong"] = 0;

  if (this.options.printStatstoConsole){
    this.startingTime = new Date();
    this.statsLastValues = [];
    if ( !this.options.printStatsInterval ) {
      this.options.printStatsInterval = 60;
    }
    var maxpad = 0;
    for (var key in this.stats){
      if ( key.length > maxpad ) {
        maxpad = key.length;
      }
    }
    var _this = this;
    this.timer = setInterval(function () {
      var now = new Date();
      var elapsed = ~~((now - _this.startingTime)/1000);
      var paused = "";
      if ( _this.paused ) { paused = " (paused)"; }
      var str = spaces(maxpad) + " total\t eps\t last\t eps\n";
      var info = "";
      var current = _this.stats;
      var tmp = _this.statsLastValues;
      for (var key in current){
        var total = current[key];
        var last = total - tmp[key];
        var leps = ~~(last / _this.options.printStatsInterval);
        var teps = ~~(total / elapsed);
        _this.statsLastValues[key] = total;
        info += key + "_total=" + total + "; " + key + "_last=" + last + "; ";  
        total = human(total);
        last = human(last);
        teps = human(teps);
        leps = human(leps);
        str += spaces(maxpad-key.length) + key + " " + total + "\t " +teps + "\t "+last+"\t "+leps+"\n";  
      }
      if (_this.eventQueue.length > 0) {
        var qfirst = _this.eventQueue[0];
        var qlast = _this.eventQueue[_this.eventQueue.length-1];
        qfirst = new Date(qfirst.time*1000);
        qlast = new Date(qlast.time*1000);
        
        str += spaces(maxpad-9) + " in queue " + _this.eventQueue.length + " ( " + qfirst + " - " + qlast + " )\n";
      }

      info += "event_queue_size=" + _this.eventQueue.length + "; ";
      info += "post_queue_size=" + _this.inPost + "; ";
      
      var lastEventTime = new Date(_this.lastEventTime * 1000);
      info += "last_event_time=" + _this.lastEventTime + "; ";
      if (process.stdout.isTTY) {
        console.log("" + now +" running since " + _this.startingTime + " elapsed " + elapsed +"s");
        console.log("stats for period "+ _this.options.printStatsInterval + "s last event "+ lastEventTime + " " + paused +"\n"+ str);
        console.log("in post:"+_this.inPost+" cummulative averages search:"+_this.searchTook+" update:"+_this.updateTook);
      } else {
        logger.info(info);
      }
    }, this.options.printStatsInterval * 1000);
  }
  //done prep, go ..
  this.emit("ready");
};


molochPlugin.prototype.close = function(callback) {
  //flusth queue async ?
  for (var i = 0; i < this.eventQueue.length; i++) {
    this.post(this.eventQueue.shift());
    debug("flushing: " + this.eventQueue.length);
  }
  // gc here ?
  this.emit("end");
};

molochPlugin.prototype.getUnixTime = function () {
    return Math.floor(new Date().getTime() / 1000);
};


molochPlugin.prototype.send = function(event) {
  var _event = {}; 
  
  this.stats["eventsIn"] += 1;
  if (event && event.event && event.event.event_second) {
    this.lastEventTime = event.event.event_second;
    _event.time = event.event.event_second;
    _event.srcIP = event.event.source_ip;
    _event.srcPort = event.event.source_port;
    _event.dstIP = event.event.destination_ip;
    _event.dstPort = event.event.dest_port;
    _event.protocol = event.event.protocol;
    _event.tags = [];
    //todo options for tags...
    _event.tags.push(this.options.tagPrefix + "_severity_" + event.event.classification.severity);
    _event.tags.push(this.options.tagPrefix + "_classification_" + event.event.classification.name);
    _event.tags.push(this.options.tagPrefix + "_signatureID_" + event.event.signature.id);
    _event.tags.push(this.options.tagPrefix + "_signature_" + event.event.signature.name);
    // same session with different tags ?
    var _new = true;
    var keys = ["srcIP","srcPort","dstIP","dstPort","protocol"]; // add time if dedup is to heavy
    for (var i=0; i < this.eventQueue.length; i++){
      var _test = this.eventQueue[i];
      var _same = true;
      for (var j = 0; j < keys.length; j++){
        var key = keys[j];
        if (_test[key] != _event[key]){
          _same = false;
          break;
        } 
      }
      if ( _same) {
          debug("same"); 
          this.stats["eventsDeduped"] += 1;
          _event.tags.push(this.options.tagPrefix + "_matched_more_than_one_sig");
          _new = false;
          debug('comparing', _event.tags, this.eventQueue[i].tags);
          for (var j = 0; j < _event.tags.length; j++){
            var found = this.eventQueue[i].tags.indexOf(_event.tags[j]);
            if ( found < 0){
              debug("pushing", _event.tags[j], this.eventQueue[i].tags);
              this.eventQueue[i].tags.push(_event.tags[j]);
            } 
          }
          break;
      }
    }
    if ( _new ) {
      this.eventQueue.push(_event);
    }
    if (this.eventQueue.length > this.options.eventQueueMaxSize){
      this.send2(this.eventQueue.shift());
    }
   } else {
    this.stats["eventsDropped"] +=1;
  }
};

molochPlugin.prototype.send2 = function(_event) { 
    var _this = this;
    if (this.inPost > this.options.maxKeepAliveSockets * 3) this.emit("full"); // kiss

    var now = this.getUnixTime();
    if ( (now - _event.time) < ( 60 ) ) { // todo: get refresh_interval from ela
      var future = ( 61 ) - (now - _event.time);
      this.stats["waitingForSessionShort"] +=1;
      setTimeout(function(){
        _this.stats["waitingForSessionShort"] -=1;
        _this.post(_event);
      }, future * 1000);
    } else  {
      this.post(_event);
    }
    
    if (this.options.minFreeMemory) {
      var freemem = os.freemem();
      if (this.options.minFreeMemory > freemem) {
        this.tagsQueue.clear();
        logger.alert("msg=\"Over the limit of minimal free memory\"; limit="+this.options.minFreeMemory+"; free_memory="+freemem);
        this.emit("error","Over the limit of minimal free memory. Limit:"+this.options.minFreeMemory+" Free:"+freemem);
        this.emit("full");
      }
    }
    if (this.options.maxHeapSize) {
      var memusage = process.memoryUsage();
      if (memusage.heapUsed > (this.options.maxHeapSize)) {
        this.tagsQueue.clear();
        logger.warning("msg=\"Over the limit of maximal heap memory\"; limit=" + this.options.maxHeapSize+"; heap_memory="+memusage.heapUsed);
        this.emit("error","Over the limit of maximal heap memory. Limit" + this.options.maxHeapSize);
        this.emit("full");
      }
    }

};


// ** helper funcs for post **

function createQuery(time,srcIP,srcPort,dstIP,dstPort,protocol,timeout){
  return query = {
             "from":0, // say sort somewhere ?
             "size":10,
             "fields" : [], //["_id","fp","lp","a1","p1","no","ro"],
             "sort": {"lp": {"order":"desc"}},
             "query":{
                "filtered":{
                   "filter":{
                      "bool":{
                         "must":[
                                /*{"term":{"no":this.nodeName+"*"}},*/ //terms as array of nodes ?
                                {"range":{"fp":{"gte":time - timeout - 1 }}},
                                {"range":{"lp":{"lte":time + timeout + 1 }}},
                                {"range":{"fp":{"lte":time}}},
                                {"range":{"lp":{"gte":time}}},
                                {"term":{"a1":srcIP}},
                                {"term":{"p1":""+srcPort}},
                                {"term":{"a2":dstIP}},
                                {"term":{"p2":""+dstPort}},
                                {"term":{"pr":""+protocol}}
                                ]
                          }
                      }
                    }
                 }
              };
} 

molochPlugin.prototype.post = function(data) {

  var _results = {};
  _results.startTime = new Date().getTime();
  this.stats["eventsPosted"] += 1;
  this.inPost += 1;
  var _this = this;

  var updateSession = function(callback) {
    //  debug("update got", JSON.stringify(_results));
    var _document = { script: "ctx._source.ta += ta", params: { ta: _results.tags } };
    // do bulk here ???
    _this.Db.update(_this.Db.id2Index(_results.sessionID), "session", _results.sessionID, _document, function (err, result) {
      _results.saved = true;
      if ( err ){
        _this.stats["sessionsTagFailed"] += 1;
        logger.error("msg=\"" + err + "\";");
        _this.emit("error",e);
        return callback("update error " + e);
        
      } 
      if ( result.error ) {
        logger.warning("msg=\"" + result.error + "\";");
        _this.emit("error",result.error);
        _this.stats["sessionsTagFailed"] += 1;
        return callback("update result error :" + result.error);
        
      } 
      _this.stats["sessionsTagged"] += 1;
      return callback(null,_results);
    });
  };

  var findTag = function(tag,callback){
    var id = _this.tagsQueue.get(tag);
    if (id){
      _this.tagsQueue.remove(tag); // is it needed, or put just updates existing ?
      _this.tagsQueue.put(tag,{"id":id.id, "count":id.count+1});
      return callback(null,id.id);
    } else {
      _this.Db.tagNameToId(tag, function (id) {
        if (id === -1) {
            _this.Db.createTag(tag, function(newid) {
              _this.tagsQueue.put(tag,{"id":newid, "count":1});
              callback(null,newid);
            });
        } else {
          _this.tagsQueue.put(tag,{"id":id, "count":1});
          return callback(null,id);
        }
      });
    }
  };

  var findTags = function(callback) {
    this.async.map(data.tags,findTag,function(err,result){
      if ( err ) {
        return callback("tagging error" + JSON.stringify(e));
      } else {
        _results.tags = result;
        return callback(null);
      }
    }); 
  };

  var findSessionID = function(callback){
    var _timeout = _this.options.tcpSaveTimeout + 60; // todo: get refresh_interval from ela
    var query = createQuery(data.time, data.srcIP, data.srcPort, data.dstIP, data.dstPort, data.protocol, _timeout);
    _this.Db.searchPrimary(_results.isIndiceName, "session", query, function(err, result) {
      _results.searchTook = result.took;
      _this.searchTook = (_this.searchTook + result.took)/2;
      if (err) {
        this.emit(err);
        return callback(err);
        
      }
      if (result.error) {
        this.emit(result.error);
        return callback(_results.error);
        
      } 
      if ( result.hits.total > 0 && result.hits.hits[0] ) {
        _this.stats["sessionsFounded"] += 1;
        _results.sessionID = result.hits.hits[0]._id;
        return callback(null);
      } else { // check timeout here 
        var now = _this.getUnixTime();
        //debug("not found",now,data.time,(now - data.time),_timeout);
        if ( (now - data.time) < (_timeout + 60) ) {
          var future = (_timeout + 60) - (now - data.time);
          //debug("future",future);
          _this.stats["waitingForSessionLong"] +=1;
          setTimeout(function(){
            _this.stats["waitingForSessionLong"] -=1;
            _this.post(data);
          }, future * 1000);
        } else {
          _this.stats["sessionsNotFound"] += 1;
        }
        return callback("session not found:"+ JSON.stringify(_results) + JSON.stringify(result) + JSON.stringify(query));
        // todo -H for query 
      }
    });
  };

  var getIndiceName = function(callback){
      var d = new Date(data.time*1000);
      // todo: find out correct indice
      var _isIndiceName = "sessions-" + twoDigitString(d.getUTCFullYear() % 100) + twoDigitString(d.getUTCMonth() + 1)+twoDigitString(d.getUTCDate());
      if (_this.dbStatustatus.indices[_isIndiceName] ) {
        _results.isIndiceName = _isIndiceName;
        return callback(null);
      } else {
        if (_this.lastMissingIndice != _isIndiceName) {
          _this.lastMissingIndice = _isIndiceName; // cache the missing iname to avoid next status query
          //refresh status
          _this.Db.status("sessions-*", function (err, status) {
            if ( err ) {
              logger.error("msg=\"" + err + "\";");
              return callback(err);
            }
            if ( status.error ) {
                logger.notice("msg=\"" + status.error + "\";");
                return callback(status.error);
            }
            _this.dbStatustatus = status;
            if ( _this.dbStatustatus.indices[_isIndiceName] ) {
              _results.isIndiceName = _isIndiceName;
              return callback(null);
            } else {
              logger.notice("msg=\"indice "+_isIndiceName+" does not exist\";");
              _this.emit("error", "indice "+_isIndiceName+" does not exist");
              return callback("indice do not exists" + _isIndiceName);
            }
          });
      } else {
        return callback("indice do not exists" + _isIndiceName);
      }
    }
  };
  // run it as waterfall with one paralel map
  this.async.waterfall([getIndiceName,findSessionID,findTags.bind(this),updateSession],function(e,r){
      if (e) {
        //all errors handled in funcs !
        //debug("POST ERROR",e);
      }
      _this.async.nextTick(function(){
        _results.endTime = new Date().getTime();
        _results.taggingTime = _results.endTime - _results.startTime;
        _this.updateTook = (_this.updateTook + _results.taggingTime)/2  ; 
        _this.inPost -= 1; 
        //debug("ended post", _this.inPost, _results.taggingTime);
        if (_this.inPost < _this.options.maxKeepAliveSockets) _this.emit("ok");
      });

  });
};


module.exports = function(options) {
  return new molochPlugin(options);
};
