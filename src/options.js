/*
 Copyright (c) 2010 Benjamin Schmaus
 Copyright (c) 2010 Jonathan Lee

 Permission is hereby granted, free of charge, to any person
 obtaining a copy of this software and associated documentation
 files (the "Software"), to deal in the Software without
 restriction, including without limitation the rights to use,
 copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following
 conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 OTHER DEALINGS IN THE SOFTWARE.
*/

var sys = require('sys');
var path = require('path');
require.paths.push(path.join(__dirname, 'optparse-js', 'src'));
var url = require('url');
var optparse = require('optparse');

// Default options
var testConfig = {
    url: '',
    method: 'GET',
    host: '',
    port: 80,
    numClients: 1,
    numRequests: Infinity,
    timeLimit: Infinity,
    targetRps: Infinity,
    path: '/',
    requestGenerator: null,
    reportInterval: 60
};
var switches = [
    [ '-n', '--number NUMBER', 'Number of requests to make. Defaults to value of --concurrency unless a time limit is specified.' ],
    [ '-c', '--concurrency NUMBER', 'Concurrent number of connections. Defaults to 1.' ],
    [ '-t', '--time-limit NUMBER', 'Number of seconds to spend running test. No timelimit by default.' ],
    [ '-e', '--request-rate NUMBER', 'Target number of requests per seconds. Infinite by default' ],
    [ '-m', '--method STRING', 'HTTP method to use.' ],
    [ '-d', '--data STRING', 'Data to send along with PUT or POST request.' ],
    [ '-f', '--flot-chart', 'If set, generate an HTML page with a Flot chart of results.'],
    [ '-r', '--request-generator STRING', 'Path to module that exports getRequest function'],
    [ '-i', '--report-interval NUMBER', 'Frequency in seconds to report statistics. Default is 60.'],
    [ '-q', '--quiet', 'Supress display of progress count info.'],
    [ '-u', '--usage', 'Show usage info' ],
];

// Create a new OptionParser.
var parser = new optparse.OptionParser(switches);
parser.banner = 'nodeload.js [options] <host>:<port>[<path>]';
parser.on('usage', function() {
    help();
});

parser.on(2, function (value) {
    if (value.search('^http://') == -1)
        value = 'http://' + value;

    testConfig.url = url.parse(value, false);
    testConfig.host = testConfig.url.hostname || testConfig.host;
    testConfig.port = Number(testConfig.url.port) || testConfig.port;
    testConfig.path = testConfig.url.pathname || testConfig.path;
});

parser.on(
    "flot-chart", function() {
        testConfig.flotChart = true;
    }
);

parser.on(
    "quiet",
    function() {
        testConfig.quiet = true;
    }
);

parser.on(
    "data", function(opt, value) {
        testConfig.requestData = value;
    }
);

parser.on('request-generator', function(opt, value) {
    var moduleName = value.substring(0, value.lastIndexOf('.'));
    testConfig.requestGeneratorModule = value;
    testConfig.requestGenerator = require(moduleName);
});

parser.on('report-interval', function(opt, value) {
    testConfig.reportInterval = Number(value);
});

parser.on('concurrency', function(opt, value) {
    testConfig.numClients = Number(value);
});

parser.on('request-rate', function(opt, value) {
    testConfig.targetRps = Number(value);
});

parser.on('number', function(opt, value) {
    testConfig.numRequests = Number(value);
});

parser.on(
    'time-limit', function(opt, value) {
        testConfig.timeLimit = Number(value*1000);
    }
);

parser.on('method', function(opt, value) {
    testConfig.method = value;
});

exports.get = function(option) {
    return testConfig[option];
};
exports.process = function() {
    parser.parse(process.argv);
    if ((testConfig.timeLimit == null) && (testConfig.numRequests == null)) {
        testConfig.numRequests = testConfig.numClients;
    }
};

function help() {
    sys.puts(parser);
    process.exit();
};
exports.help = help;

