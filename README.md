#pigsty-moloch-plugin ver 0.0.0

## Moloch

see https://github.com/aol/moloch

## Pigsty

see https://github.com/threatstack/pigsty

## usage 

... in writing ...

```
 
 $# npm install https://github.com/hillar/pigsty-moloch-plugin/archive/master.tar.gz

 $# DEBUG=pigsty-moloch-plugin pigsty -c /etc/pigsty/config.js

 ```

## sample config

```

module.exports = {

  // you must remove this line!
  // unconfigured: true, 

  sensor: {
     // your sensor name, e.g. 'my-sensor-1' 
     name: 'pigsty',

     // your sensor interface, e.g. 'eth0'
     interface: 'eth0'
  },

  // these must be set correctly !
  references: {

    reference_file:      '/etc/suricata/reference.config',
    classification_file: '/etc/suricata/classification.config',
    gen_file:            '/etc/suricata/rules/gen-msg.map',
    sid_file:            '/etc/suricata/rules/sid-msg.map'
  },

  logs: {
    // e.g., /var/snort/logs
    path: '/var/log/suricata',

    // either 'continuous' or 'read'.  Will exit after reading unless mode == 'continuous'.
    mode: 'continuous', 

    // Where to store the bookmark for unified2 logs. default is /etc/pigsty/.bookmark
    bookmark: '/var/run/pigsty/.bookmark',

},

  // configure your output plugins here.
  output: {
  
    'moloch-plugin': {
      molochConfigFileLocation: '/data/moloch/etc/config.ini',
      asyncModuleLocation: '/data/moloch/viewer/node_modules/async/lib/async.js',
      keepaliveagentModuleLocation: '/data/moloch/viewer/node_modules/keep-alive-agent/index.js',
      dbModuleLocation : '/data/moloch/viewer/db.js',  
      printStatstoConsole: true,
    },
  } 
}

```

options you must set

molochConfigFileLocation full path
dbModuleLocation full path


options you can set:

iniparserModuleLocation
asyncModuleLocation
keepaliveagentModuleLocation full path

eventQueueMaxSize int 
minFreeMemory int bytes
maxHeapSize int bytes

maxKeepAliveSockets int

printStatstoConsole true/false
printStatsInterval int seconds

tagPrefix


optiond withs hardcoded defaults

iniparserModuleLocation = 'iniparser';
keepaliveagentModuleLocation = 'keep-alive-agent';
asyncModuleLocation = 'async';

eventQueueMaxSize = 1024;
maxHeapSize = 1073741824*10;
maxKeepAliveSockets = 32;
minFreeMemory = 1073741824/10;
tagPrefix = 'unified2';

printStatstoConsole = null;
printStatsInterval = null;
tagPrefix = 'unified2'

  