// -----------------------------------------
// Distributed testing
// -----------------------------------------
//
// This file contains the API for distributing load tests across multiple load generating nodes. See
// NODELOADLIB.md for instructions on running a distributed test. 
//
// Distributed tests work as follows:
// 1. One node is designated as master, and the others are slaves
// 2. The master node POSTs a string containing valid javascript to http://slave/remote on each slave
// 3. Each slave executes the javascript by calling eval().
// 4. Each slave periodically POSTs statistics as a JSON string back to the master at http://master/remote/progress
// 5. The master aggregates these statistics and generates reports just like a regular, non-distributed nodeloadlib instance
//

var SLAVE_CONFIG = null;
var WORKER_POOL = null;
var SLAVE_PING_PERIOD = 3000;

/** Returns a test that can be scheduled with `remoteStart(spec)` (See TEST_DEFAULTS in api.ja for a list
    of the configuration values that can be provided in the test specification */
remoteTest = function(spec) {
    return "(function() {\n" +
            "  var remoteSpec = JSON.parse('" + JSON.stringify(spec) + "');\n" +
            "  remoteSpec.requestGenerator = " + spec.requestGenerator + ";\n" +
            "  remoteSpec.requestLoop = " + spec.requestLoop + ";\n" +
            "  remoteSpec.reportFun = " + spec.reportFun + ";\n" +
            "  addTest(remoteSpec);\n" +
            "})();\n";
}

/** Run the list of tests, created by remoteTest(spec), on the specified slaves. Slaves will periodically 
    report statistics to master. When all tests complete, callback will be called. If stayAliveAfterDone 
    is true, then the nodeload HTTP server will remain running. Otherwise, the server will automatically
    terminate once the tests are finished. */
remoteStart = function(master, slaves, tests, callback, stayAliveAfterDone) {
    var remoteFun = "";
    for (var i in tests) {
        remoteFun += tests[i];
    }
    remoteFun += "startTests();\n";
    remoteSubmit(master, slaves, remoteFun, callback, stayAliveAfterDone);
}

/** Same as remoteStart(...), except runs a .js nodeload script rather than tests created using 
    remoteTest(spec). The script should use `addTest()` and `startTests()` to create and start tests,
    as if it were to run on the local machine, not remoteTest().  */
remoteStartFile = function(master, slaves, filename, callback, stayAliveAfterDone) {
    fs.readFile(filename, function (err, data) {
        if (err != null) throw err;
        data = data.replace(/^#![^\n]+\n/, '// removed shebang directive from runnable script\n');
        remoteSubmit(master, slaves, data, callback, stayAliveAfterDone);
    });
}

// =================
// Private methods
// =================
/** Creates a RemoteWorkerPool with the given master and slave and runs the specified code, fun, on 
    every slave node in the pool. fun is a string containing valid Javascript. callback and 
    stayAliveAfterDone are the same as for remoteStart(). */
function remoteSubmit(master, slaves, fun, callback, stayAliveAfterDone) {
    WORKER_POOL = new RemoteWorkerPool(master, slaves);
    WORKER_POOL.fun = fun;
    WORKER_POOL.start(callback, stayAliveAfterDone);
}

/** Converts this nodeload instance into a slave node by defining the global variable SLAVE_CONFIG.
    A slave node differ from normal (master) node because it sends statistics to a master node. */
function registerSlave(id, master) {
    SLAVE_CONFIG = new RemoteSlave(id, master);
}

/** A RemoteSlave represents a slave nodeload instance. RemoteSlave.reportProgress() POSTs statistics
    as a JSON formatted string to http://master/remote/progress. */
function RemoteSlave(id, master) {
    var master = (master == null) ? ["", 0] : master.split(":");
    this.id = id;
    this.masterhost = master[0];
    this.master = http.createClient(master[1], master[0]);
}
RemoteSlave.prototype = {
    sendReport: function(url, object) {
        var s = JSON.stringify(object);
        var req = this.master.request('POST', url, {'host': this.masterhost, 'content-length': s.length});
        req.write(s);
        req.end();
    },
    reportProgress: function(stats) {
        this.sendReport('/remote/progress', {slaveId: this.id, stats: stats});
    },
}
/** Represents a pool of nodeload instances with one master and multiple slaves. master and each slave 
    is specified as a string "host:port". Each slave node executes the Javascript specified in the "fun"
    string, and upon completion, "callback" is executed. */
function RemoteWorkerPool(master, slaves) {
    this.master = master;
    this.slaves = {};
    this.fun = null;
    this.callback = null;
    this.pingId = null;
    this.progressId = null;
    this.stats = {};

    for (var i in slaves) {
        var slave = slaves[i].split(":");
        this.slaves[slaves[i]] = {
            id: slaves[i],
            state: "notstarted",
            host: slave[0], 
            client: http.createClient(slave[1], slave[0])
        };
    }
}
RemoteWorkerPool.prototype = {
    /** Run the Javascript in the string RemoteWorkerPool.fun on each of the slave node and register
        a periodic alive check for each slave. */
    start: function(callback, stayAliveAfterDone) {
        // Construct a Javascript string which converts a nodeloadlib instance to a slave, and wraps
        // executes the contents of "fun" by placing it in an anonymous function call:
        //      registerSlave(slave-id, master-host:port);
        //      (function() { 
        //          contents of "fun", which usually contains calls to addTest(), startTests(), etc
        //      })()
        var fun = "(function() {" + this.fun + "})();";
        for (var i in this.slaves) {
            var slave = this.slaves[i];
            var slaveFun = "registerSlave('" + i + "','" + this.master + "');\n" + fun;
            // POST the Javascript string to each slave which will eval() it.
            var r = slave.client.request('POST', '/remote', {'host': slave.host, 'content-length': slaveFun.length});
            r.write(slaveFun);
            r.end();
            slave.state = "running";
        }

        // Register a period ping to make sure slave is still alive
        var worker = this;
        this.pingId = setInterval(function() { worker.sendPings() }, SLAVE_PING_PERIOD);
        this.callback = testsComplete(callback, stayAliveAfterDone);
        summaryStats = [this.stats];
    },
    /** Called after each round of slave pings to see if all the slaves have finished. A slave is "finished"
        if it reports that it finished successfully, or if it fails to respond to a ping and flagged with
        an error state. When all slaves are finished, the overall test is considered complete and the user 
        defined callback function is called. */
    checkFinished: function() {
        for (var i in this.slaves) {
            if (this.slaves[i].state != "done" && this.slaves[i].state != "error") {
                return;
            }
        }
        qprint("\nRemote tests complete.");
        
        var callback = this.callback;
        clearInterval(this.pingId);
        this.callback = null;
        this.slaves = {};
        if (callback != null) {
            callback();
        }
    },
    /** Issue a GET request to each slave at "http://slave/remote/state". This function is called every
        SLAVE_PING_PERIOD seconds. If a slave fails to respond in that amount of time, it is flagged with
        an error state. A slave will report that it is "done" when its SCHEDULER is no longer running, i.e.
        all its tests ran to completion (or no tests were started, because "fun" didn't call to startTests()). */
    sendPings: function() {
        var worker = this;
        // Read the response from ping() (GET /remote/state)
        var pong = function(slave) { return function(response) {
            if (slave.state == "ping") {
                if (response.statusCode == 200) {
                    slave.state = "running";
                } else if (response.statusCode == 410) {
                    qprint("\n" + slave.id + " done.");
                    slave.state = "done";
                }
            }
        }}
        // Send GET to /remote/state
        var ping = function(slave) {
            slave.state = "ping";
            var r = slave.client.request('GET', '/remote/state', {'host': slave.host, 'content-length': 0});
            r.on('response', pong(slave));
            r.end();
        }

        // Verify every slave responded to the last round of pings. Send ping to slave that are still alive.
        for (var i in this.slaves) {
            if (this.slaves[i].state == "ping") {
                qprint("\nWARN: slave " + i + " unresponsive.");
                this.slaves[i].state = "error";
            } else if (this.slaves[i].state == "running") {
                ping(this.slaves[i]);
            }
        }
        this.checkFinished();
    },
    /** Every time the master receives a progress report is received from a slave, update the overall 
        statistics. Since all the slaves will be on the same reporting schedule, we can expect the master
        to receive progress reports from all slaves at approxmiate the same time. We allow a 500ms window
        between the first and last report to arrive before updating the master stats. */
    scheduleProgressReport: function() {
        if (this.progressId == null) {
            var worker = this;
            this.progressId = setTimeout(function() { 
                defaultProgressReport(worker.stats);
                worker.progressId = null;
            }, 500);
        }
    },
    /** Process data received POSTed by a slave to http://master/remote/progress */
    receiveProgress: function(report) {
        if (this.slaves[report.slaveId] == null)
            return;
        this.slaves[report.slaveId].state = "running";
        for (var i in report.stats) {
            var stat = report.stats[i].name;
            if (this.stats[stat] == null) {
                var backend = statsClassFromString(report.stats[i].interval.type);
                this.stats[stat] = new Reportable([backend, report.stats[i].interval.params], stat, report.stats[i].addToHttpReport);
            }
            this.stats[stat].merge(report.stats[i].interval);
        }
        this.scheduleProgressReport();
    },
}

/** Handler for all the requests to /remote. See http.js#startHttpServer(). */
function serveRemote(url, req, res) {
    var readBody = function(req, callback) {
        var body = '';
        req.on('data', function(chunk) { body += chunk });
        req.on('end', function() { callback(body) });
    }
    var sendStatus = function(status) {
        res.writeHead(status, {"Content-Length": 0});
        res.end();
    }
    if (req.method == "POST" && url == "/remote") {
        readBody(req, function(remoteFun) {
            qputs("Starting remote test:\n" + remoteFun);
            eval(remoteFun);
            sendStatus(200);
        });
    } else if (req.method == "GET" && req.url == "/remote/state") {
        if (SCHEDULER.running == true) {
            res.writeHead(200, {"Content-Length": 0});
        } else {
            res.writeHead(410, {"Content-Length": 0});
        }
        res.end();
    } else if (req.method == "POST" && url == "/remote/stop") {
        qprint("\nReceived remote stop...");
        SCHEDULER.stopAll();
        sendStatus(200);
    } else if (req.method == "POST" && url == "/remote/progress") {
        readBody(req, function(report) {
            WORKER_POOL.receiveProgress(JSON.parse(report));
            sendStatus(200);
        });
    } else {
        sendStatus(405);
    }
}

