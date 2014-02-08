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
## options
### options you must set

```
molochConfigFileLocation full path
dbModuleLocation full path
```

### options you may set

```
iniparserModuleLocation full path
asyncModuleLocation full path
keepaliveagentModuleLocation full path
eventQueueMaxSize int 
minFreeMemory int bytes
maxHeapSize int bytes
maxKeepAliveSockets int
printStatstoConsole true/false
printStatsInterval int seconds
tagPrefix
```

### options hardcoded defaults

```
iniparserModuleLocation = 'iniparser';
keepaliveagentModuleLocation = 'keep-alive-agent';
asyncModuleLocation = 'async';
eventQueueMaxSize = 128;
maxKeepAliveSockets = 20;
printStatsInterval = 60;
tagPrefix = 'unified2'
```

### stats
#### reading history in

```
Sat Feb 08 2014 02:58:26 GMT+0200 (EET) running since Sat Feb 08 2014 02:53:26 GMT+0200 (EET) elapsed 300s
stats for period 60s last event Fri Feb 07 2014 07:57:40 GMT+0200 (EET) 
                       total     eps     last    eps
              eventsIn 5K        17      1001    16
         eventsDropped 0         0       0       0
         eventsDeduped 1K        5       294     4
          eventsPosted 3K        11      707     11
       sessionsFounded 2K        9       630     10
      sessionsNotFound 609       2       89      1
        sessionsTagged 2K        9       662     11
     sessionsTagFailed 0         0       0       0
waitingForSessionShort 0         0       0       0
 waitingForSessionLong 0         0       0       0
              in queue 128 ( Fri Feb 07 2014 07:56:29 GMT+0200 (EET) - Fri Feb 07 2014 07:57:40 GMT+0200 (EET) )
               in post 16 cummulative averages search:1416.2413494892726 update:4478.562879542753
```


#### tailing

```
Sat Feb 08 2014 14:55:28 GMT+0200 (EET) running since Sat Feb 08 2014 02:53:26 GMT+0200 (EET) elapsed 43321s
stats for period 60s last event Sat Feb 08 2014 14:55:25 GMT+0200 (EET) 
                       total   eps   last  eps
              eventsIn 2M      54    1K    29
         eventsDropped 25      0     1     0
         eventsDeduped 1M      26    874   14
          eventsPosted 1M      28    975   16
       sessionsFounded 1M      27    920   15
      sessionsNotFound 38K     0     31    0
        sessionsTagged 1M      27    920   15
     sessionsTagFailed 0       0     0     0
waitingForSessionShort 724     0     33    0
 waitingForSessionLong 365     0     -89   -1
              in queue 128 ( Sat Feb 08 2014 14:55:17 GMT+0200 (EET) - Sat Feb 08 2014 14:55:25 GMT+0200 (EET) )
               in post 0 cummulative averages search:18.512892846629544 update:30.991601954585136
```


  