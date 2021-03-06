// ------------------------------------
// Statistics
// ------------------------------------
//
// Contains various statistics classes and function. The classes implement the same consistent interface. 
// See NODELOADLIB.md for a complete description of the classes and functions.

Histogram = function(params) {
    // default histogram size of 3000: when tracking latency at ms resolution, this
    // lets us store latencies up to 3 seconds in the main array
    var numBuckets = 3000;
    var percentiles = [0.95, 0.99];

    if (params != null && params.numBuckets != null)
        numBuckets = params.buckets;
    if (params != null && params.percentiles != null)
        percentiles = params.percentiles;
    
    this.type = "Histogram";
    this.params = params;
    this.size = numBuckets;
    this.percentiles = percentiles;
    this.clear();
}
Histogram.prototype =  {
    clear: function() {
        this.start = new Date();
        this.length = 0;
        this.sum = 0;
        this.min = -1;
        this.max = -1;
        this.items = new Array(this.size);      // The main histogram buckets
        this.extra = [];                        // Any items falling outside of the buckets
        this.sorted = true;                     // Is extra[] currently sorted?
    },
    put: function(item) {
        this.length++;
        this.sum += item;
        if (item < this.min || this.min == -1) this.min = item;
        if (item > this.max || this.max == -1) this.max = item;
        
        if (item < this.items.length) {
            if (this.items[item] != null) {
                this.items[item]++;
            } else {
                this.items[item] = 1;
            }
        } else {
            this.sorted = false;
            this.extra.push(item);
        }
    },
    get: function(item) {
        if (item < this.items.length) {
            return this.items[item];
        } else {
            var count = 0;
            for (var i in this.extra) {
                if (this.extra[i] == item) {
                    count++;
                }
            }
            return count;
        }
    },
    mean: function() {
        return this.sum / this.length;
    },
    percentile: function(percentile) {
        var target = Math.floor(this.length * (1 - percentile));
        
        if (this.extra.length > target) {
            var idx = this.extra.length - target;
            if (!this.sorted) {
                this.extra = this.extra.sort(function(a, b) { return a - b });
                this.sorted = true;
            }
            return this.extra[idx];
        } else {
            var sum = this.extra.length;
            for (var i = this.items.length - 1; i >= 0; i--) {
                if (this.items[i] != null) {
                    sum += this.items[i];
                    if (sum >= target) {
                        return i;
                    }
                }
            }
            return 0;
        }
    },
    stddev: function() {
        var mean = this.mean();
        var s = 0;
        
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i] != null) {
                s += this.items[i] * Math.pow(i - mean, 2);
            }
        }
        this.extra.forEach(function (val) {
            s += Math.pow(val - mean, 2);
        });
        return Math.sqrt(s / this.length);
    },
    summary: function() {
        var s = {
            min: this.min,
            max: this.max,
            avg: Number(this.mean().toFixed(1)),
            median: this.percentile(.5)
        };
        for (var i in this.percentiles) {
            s[this.percentiles[i] * 100 + "%"] = this.percentile(this.percentiles[i]);
        }
        return s;
    },
    merge: function(other) {
        if (this.items.length != other.items.length) {
            throw "Incompatible histograms";
        }

        this.length += other.length;
        this.sum += other.sum;
        this.min = (other.min != -1 && (other.min < this.min || this.min == -1)) ? other.min : this.min;
        this.max = (other.max > this.max || this.max == -1) ? other.max : this.max;
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i] != null) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
            }
        }
        this.extra = this.extra.concat(other.extra);
        this.sorted = false;
    }
}

Accumulator = function() {
    this.type = "Accumulator";
    this.total = 0;
    this.length = 0;
}
Accumulator.prototype = {
    put: function(stat) {
        this.total += stat;
        this.length++;
    },
    get: function() {
        return this.total;
    },
    clear: function() {
        this.total = 0;
        this.length = 0;
    },
    summary: function() {
        return { total: this.total };
    },
    merge: function(other) {
        this.total += other.total;
        this.length += other.length;
    }
}

ResultsCounter = function() {
    this.type = "ResultsCounter";
    this.start = new Date();
    this.items = {};
    this.items.total = 0;
    this.length = 0;
}
ResultsCounter.prototype = {
    put: function(item) {
        if (this.items[item] != null) {
            this.items[item]++;
        } else {
            this.items[item] = 1;
        }
        this.length++;
    },
    get: function(item) {
        if (item.length > 0) {
            var total = 0;
            for (var i in item) {
                total += this.items[i];
            }
            return total;
        } else {
            return this.items[item];
        }
    },
    clear: function() {
        this.start = new Date();
        this.items = {};
        this.length = 0;
    },
    summary: function() {
        this.items.total = this.length;
        this.items.rps = Number((this.length / ((new Date() - this.start) / 1000)).toFixed(1));
        return this.items;
    },
    merge: function(other) {
        for (var i in other.items) {
            if (this.items[i] != null) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
            }
        }
        this.length += other.length;
    }
}

Uniques = function() {
    this.type = "Uniques";
    this.start = new Date();
    this.items = {};
    this.uniques = 0;
    this.length = 0;
}
Uniques.prototype = {
    put: function(item) {
        if (this.items[item] != null) {
            this.items[item]++;
        } else {
            this.items[item] = 1;
            this.uniques++
        }
        this.length++;
    },
    get: function() {
        return this.uniques;
    },
    clear: function() {
        this.items = {};
        this.unqiues = 0;
        this.length = 0;
    },
    summary: function() {
        return {total: this.length, uniqs: this.uniques};
    },
    merge: function(other) {
        for (var i in other.items) {
            if (this.items[i] != null) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
                this.uniques++;
            }
        }
        this.length += other.length;
    }
}

Peak = function() {
    this.type = "Peak";
    this.peak = 0;
    this.length = 0;
}
Peak.prototype = {
    put: function(item) {
        if (this.peak < item) {
            this.peak = item;
        }
        this.length++;
    },
    get: function(item) {
        return this.peak;
    },
    clear: function() {
        this.peak = 0;
    },
    summary: function() {
        return { max: this.peak };
    },
    merge: function(other) {
        if (this.peak < other.peak) {
            this.peak = other.peak;
        }
        this.length += other.length;
    }
}

Rate = function() {
    type = "Rate";
    this.start = new Date();
    this.length = 0;
}
Rate.prototype = {
    put: function() {
        this.length++;
    },
    get: function() {
        return this.length /  ((new Date() - this.start) / 1000);
    },
    clear: function() {
        this.start = new Date();
        this.length = 0;
    },
    summary: function() {
        return { rps: this.get() };
    },
    merge: function(other) {
        this.length += other.length;
    }
}

LogFile = function(filename) {
    this.type = "LogFile";
    this.length = 0;
    this.filename = filename;
    this.open();
}
LogFile.prototype = {
    put: function(item) {
        fs.write(this.fd, item + "\n", null, "ascii");
        this.length++;
    },
    get: function(item) {
        fs.statSync(this.filename, function (err, stats) {
            if (err == null) item = stats;
        });
        return item;
    },
    clear: function() {
        this.close();
        this.open();
    },
    open: function() {
        this.fd = fs.openSync(
            this.filename,
            process.O_WRONLY|process.O_CREAT|process.O_TRUNC,
            process.S_IRWXU|process.S_IRWXG|process.S_IROTH);
    },
    close: function() {
        fs.closeSync(this.fd);
        this.fd = null;
    },
    summary: function() {
        return { file: this.filename, written: this.length };
    }
}

NullLog = function() { 
    this.type = "NullLog";
    this.length = 0;
}
NullLog.prototype = {
    put: function(item) { /* nop */ },
    get: function(item) { return null; },
    clear: function() { /* nop */ }, 
    open: function() { /* nop */ },
    close: function() { /* nop */ },
    summary: function() { return { file: 'null', written: 0 } }
}

Reportable = function(backend, name, addToHttpReport) {
    var backendparams = null;
    if (name == null)
        name = "";
    if (typeof backend == 'object') {
        backendparams = backend[1];
        backend = backend[0];
    }
        
    this.type = "Reportable";
    this.name = name;
    this.length = 0;
    this.interval = new backend(backendparams);
    this.cumulative = new backend(backendparams);
    this.addToHttpReport = addToHttpReport;
    
    if (addToHttpReport) {
        HTTP_REPORT.addChart(this.name);
    }
}
Reportable.prototype = {
    put: function(stat) {
        if (!this.disableIntervalReporting) {
            this.interval.put(stat);
        }
        this.cumulative.put(stat);
        this.length++;
    },
    get: function() { 
        return null; 
    },
    clear: function() {
        this.interval.clear();
        this.cumulative.clear();
    }, 
    next: function() {
        if (this.interval.length > 0)
            this.interval.clear();
    },
    summary: function() {
        return { interval: this.interval.summary(), cumulative: this.cumulative.summary() };
    },
    merge: function(other) {
        // other should be an instance of backend, NOT Reportable.
        this.interval.merge(other);
        this.cumulative.merge(other);
    }
}

roundRobin = function(list) {
    r = list.slice();
    r.rridx = -1;
    r.get = function() {
        this.rridx = (this.rridx+1) % this.length;
        return this[this.rridx];
    }
    return r;
}

randomString = function(length) {
    var s = "";
    for (var i = 0; i < length; i++) {
        s += '\\' + (Math.floor(Math.random() * 95) + 32).toString(8); // ascii chars between 32 and 126
    }
    return eval("'" + s + "'");
}

nextGaussian = function(mean, stddev) {
    if (mean == null) mean = 0;
    if (stddev == null) stddev = 1;
    var s = 0, z0, z1;
    while (s == 0 || s >= 1) {
        z0 = 2 * Math.random() - 1;
        z1 = 2 * Math.random() - 1;
        s = z0*z0 + z1*z1;
    }
    return z0 * Math.sqrt(-2 * Math.log(s) / s) * stddev + mean;
}

nextPareto = function(min, max, shape) {
    if (shape == null) shape = 0.1;
    var l = 1, h = Math.pow(1+max-min, shape), rnd = Math.random();
    while (rnd == 0) rnd = Math.random();
    return Math.pow((rnd*(h-l)-h) / -(h*l), -1/shape)-1+min;
}

function statsClassFromString(name) {
    types = {
        "Histogram": Histogram, 
        "Accumulator": Accumulator, 
        "ResultsCounter": ResultsCounter,
        "Uniques": Uniques,
        "Peak": Peak,
        "Rate": Rate,
        "LogFile": LogFile,
        "NullLog": NullLog,
        "Reportable": Reportable
    };
    return types[name];
}

