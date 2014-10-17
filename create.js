var auto = require('run-auto');
var chalk = require('chalk');
var Wizzard = require('wizzard').Wizzard;
var path = require('path');
var callNgen = require('uber-ngen/bin/ngen.js');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var format = require('util').format;
var series = require('run-series');

function create() {
    var context = {};

    auto({
        'checkShared': checkShared.bind(null, context),
        'getBasicInfo': getBasicInfo.bind(null, context),
        'createScaffold': [
            'getBasicInfo',
            createScaffold.bind(null, context)
        ],
        'initRepo': [
            'createScaffold',
            initRepo.bind(null, context)
        ],
        'createGithub': [
            'initRepo',
            createGithub.bind(null, context)
        ],
        'coveralls': [
            'createGithub',
            coveralls.bind(null, context)
        ],
        'travis': [
            'coveralls', 'createGithub',
            travis.bind(null, context)
        ],
        'pushCode': [
            'travis',
            pushCode.bind(null, context)
        ],
        'npmInstall': [
            'createScaffold',
            npmInstall.bind(null, context)
        ]
    }, done);

    function done(err) {
        if (err) {
            console.error(err);
            process.exit(1);
        }

        console.log('');
        console.log('Successfully created');
        console.log('');
        console.log(' ' + chalk.green(' - git remote: ') +
            context.gitRemote);
        console.log(' ' + chalk.green(' - code base: ') +
            path.join(process.cwd(), context.name));
        console.log(' ' + chalk.green(' - github: ') +
            'https://github.com/' + context.githubRemote);
        console.log(' ' + chalk.green(' - travis: ') +
            'https://travis-ci.org/' + context.githubRemote);
        console.log(' ' + chalk.green(' - coveralls: ') +
            'https://coveralls.io/r/' + context.githubRemote);
        console.log('');

        process.exit(0);
    }
}

module.exports = create;

function checkShared(context, cb) {
    cb(null);
}

function getBasicInfo(context, cb) {
    console.log('getBasicInfo');
    nameAndDescription(onNameAndDesc);

    function nameAndDescription(listener) {
        var outer = new Wizzard();

        outer.addText('');
        if (!context.name) {
            outer.addInput(' ' + chalk.green('*') +
              ' What is your project called?', validateName);
        }
        outer.addInput(' ' + chalk.green('*') +
            ' What does your project do? (description)');

        outer.on('end', listener);

        outer.run();
    }

    function onNameAndDesc(results) {
        if (!context.name) {
            context.name = results[0];
        }
        context.desc = results[1] || results[0];

        if (!context.name || !context.desc) {
            context.logger(1,
                'Name and description are required!\n');
            return nameAndDescription(onNameAndDesc);
        }

        cb(null);
    }

    function validateName(input) {
        input = input.toLowerCase();
        var nameValidation = projectNameValid(input);
        nameValidation.error += ':';
        return nameValidation;
    }

    function projectNameValid(name) {
        if (name.length > 64) {
            return {
                'success' : false,
                'error': 'Project names should be 64 ' +
                    'character or shorter'
            };
        }

        return {
            'success':/^[a-z][a-z0-9-]*$/.test(name),
            'error': 'Names must start with a letter and can ' +
                'only contain letters, numbers and "-"'
        };
    }
}

function createScaffold(context, cb) {
    console.log('createScaffold');

    callNgen({
        template: 'github',
        directory: path.join(__dirname, 'templates'),
        name: context.name,
        description: context.desc,
        logger: { log: function () { return; } }
    }, cb);
}

function createGithub(context, cb) {
    console.log('createGithub');

    fetchFromGitConfig('user.name')({}, onUserName);

    function onUserName(err, name) {
        if (err) {
            return cb(err);
        }

        var project = name.trim() + '/' + context.name;

        exec('hub create ' + project, {
            cwd: path.join(process.cwd(), context.name)
        }, function (err) {
            if (err) {
                return cb(err);
            }

            context.gitRemote = 'git@github.com:' + project;
            context.githubRemote = project;
            cb(null);
        });
    }

    function fetchFromGitConfig(key) {
        function readValue(values, callback) {
            var called = false;
            var proc = spawn('git', [
                '--bare',
                'config',
                '--global',
                key
            ]);

            proc.stdout.once('data', function (chunk) {
                called = true;
                callback(null, String(chunk));
            });
            proc.stdout.once('error', callback);
            proc.stdout.once('end', function () {
                if (called) {
                    return;
                }

                var message = format('please configure %s in git', key);
                callback(new Error(message));
            });
        }

        return readValue;
    }
}

function initRepo(context, cb) {
    console.log('initRepo');

    var gitDir = path.join(process.cwd(), context.name);

    gitrun(['init'], gitDir, cb);
}

function pushCode(context, cb) {
    console.log('pushCode');
    var gitDir = path.join(process.cwd(), context.name);

    series([
        gitrun.bind(null, ['add', '--all'], gitDir),
        gitrun.bind(null, [
            'commit', '--all', '--message', 'initial commit'
        ], gitDir),
        gitrun.bind(null, [
            'push', 'origin', 'master'
        ], gitDir)
    ], cb);
}

function gitrun(cmds, cwd, cb) {
    var git = spawn('git', cmds, {
        cwd: cwd
    });
    var buf = [];

    // git.stdout.pipe(process.stdout);
    git.stderr.on('data', function (line) {
        buf.push(line.toString());
    });

    git.on('error', cb);

    git.on('close', function (code) {
        if (code !== 0) {
            cb(new Error('git ' + cmds.join(' ') +
                ' returned with code ' + code));
        }
        cb(null, buf);
    });
}

function travis(context, cb) {
    console.log('travis');
    var gitDir = path.join(process.cwd(), context.name);

    exec('travisify', {
        cwd: gitDir
    }, function (err) {
        if (err) {
            return cb(err);
        }

        exec('travisify test', {
            cwd: gitDir
        }, cb);
    });
}

function npmInstall(context, cb) {
    console.log('npm install');
    var gitDir = path.join(process.cwd(), context.name);

    exec('npm install', {
        cwd: gitDir
    }, cb);

}

function coveralls(context, cb) {
    var wiz = new Wizzard();

    wiz.addText('Setup coveralls. Go to https://coveralls.io' +
        '/repos/new and add ' + context.name);
    wiz.addInput('Did you turn on coveralls?', ['y', 'n']);

    wiz.on('end', cb.bind(null, null));

    wiz.run();
}
