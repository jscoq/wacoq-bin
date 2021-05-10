// Build with
//  parcel watch --hmr-hostname=localhost --public-url '.' src/index.html src/worker.ts &

import { PackageIndex } from './backend/packages';
import { IcoqSubprocess } from './backend/subproc';
import { InteractiveConsole } from './ui/console';



function main(opts: any = {}) {
    var startTime = +new Date(),
        elapsed = () => +new Date() - startTime;

    function milestone(caption: string) {
        console.log(`%c${caption} (+${elapsed()}ms)`, 'color: #99f');
    }

    var worker: Worker | IcoqSubprocess, coqlib: string;
    if (opts.subproc) {
        worker = new IcoqSubprocess();
        coqlib = worker.binDir + '/coqlib';
    }
    else {
        worker = new Worker(0 || './dist/worker.js');  // bypass Parcel (fails to build worker at the moment)
    }

    function sendCommand(cmd: any) {
        worker.postMessage(JSON.stringify(cmd));
    }

    var consl = new InteractiveConsole(),
        tip = 0,
        queue = ['Check nat.', 'Check Prop.'];

    worker.addEventListener('message', (ev) => {
        console.log(ev.data);

        switch (ev.data[0]) {
        case 'Starting':
            milestone('Starting');
            consl.showProgress('Starting', {done: false});  break;
        case 'Boot':
            milestone('Boot');
            sendCommand(['Init', {coqlib}]);
            sendCommand(['NewDoc', {}]);  break;
        case 'Ready':
            milestone('Ready');
            consl.showProgress('Starting', {done: true});
            nextStmt();
            break;
        case 'Added':
            sendCommand(['Exec', ev.data[1]]);
            sendCommand(['Query', ev.data[1], 0, ['Goals']]); break;
        case 'Pending':
            let [, sid, prefix, modrefs] = ev.data;
            pi.loadModuleDeps(pi.findModules(prefix, modrefs)).then(() => {
                console.log('resolved');
                if (stms[sid]) {
                    sendCommand(['RefreshLoadPath']);
                    sendCommand(['Add', null, sid, stms[sid], true]);
                };
            });
            break;
        case 'GoalInfo':
            if (ev.data[2]) consl.writeGoals(ev.data[2]);  break;
        case 'CoqExn':
            if (ev.data[3]) consl.write(ev.data[3]);
            break;
        case 'Feedback':
            switch (ev.data[1].contents[0]) {
            case 'Message':
                consl.write(ev.data[1].contents[3]); break;
            case 'Processed':
                if (ev.data[1].span_id === tip) nextStmt(); break;
            }
            break;
        case 'LibProgress':
            var e = ev.data[1];
            if (e.uri) {
                var basename = e.uri.replace(/.*[/]/, ''),
                    msg = `Downloading ${basename}...`;
                consl.showProgress(e.uri, e, msg);
            }
            break;
        }
    });
    
    function stmt(line: string) {
        tip = ++sid;
        stms[tip] = line;
        sendCommand(['Add', null, tip, line, false]);
    }

    function nextStmt() {
        if (queue.length) stmt(queue.shift());
    }

    let sid = 4, stms = {};

    consl.on('data', (line) => stmt(line));

    consl.on('load-pkg', (ev) => worker.postMessage(['LoadPkg', ev.uri]));

    window.addEventListener('dragover', ev => ev.preventDefault());
    window.addEventListener('drop', ev => {
        ev.preventDefault();
        pi.addBlob(ev.dataTransfer.files[0]);
    });

    var pi = new PackageIndex().attach(worker);
    pi.populate(['coq'], '../bin/coq');
    //pi.loadInfo(['/scratch/fcsl-pcm.json']);

    Object.assign(window, {worker, pi});
}



Object.assign(window, {main});
