// Build with
//  parcel watch --hmr-hostname=localhost --public-url '.' src/index.html src/worker.ts &

import { PackageIndex } from './backend/packages';
import { InteractiveConsole } from './ui/console';



function main() {
    var startTime = +new Date(),
        elapsed = () => +new Date() - startTime;

    function milestone(caption) {
        console.log(`%c${caption} (+${elapsed()}ms)`, 'color: #99f');
    }

    var worker = new Worker(0 || './worker.js');  // bypass Parcel (fails to build worker at the moment)


    function sendCommand(cmd) {
        worker.postMessage(JSON.stringify(cmd));
    }

    var consl = new InteractiveConsole();

    worker.addEventListener('message', (ev) => {
        console.log(ev.data);

        switch (ev.data[0]) {
        case 'Starting':
            milestone('Starting');
            consl.showProgress('Starting', {done: false});  break;
        case 'Boot':
            milestone('Boot');
            sendCommand(['Init', {}]); break;
        case 'Ready':
            milestone('Ready');
            consl.showProgress('Starting', {done: true});
            sendCommand(['Add', null, null, 'Check nat.', true]);
            break;
        case 'Added':
            sendCommand(['Exec', ev.data[1]]);
            sendCommand(['Goals', ev.data[1]]); break;
        case 'Pending':
            let [, sid, prefix, modrefs] = ev.data;
            pi.loadModuleDeps(pi.findModules(prefix, modrefs)).then(() => {
                console.log('resolved');
                if (stms[sid])
                    sendCommand(['Add', null, sid, stms[sid], true]);
            });
            break;
        case 'GoalInfo':
            if (ev.data[2]) consl.writeGoals(ev.data[2]);  break;
        case 'CoqExn':
            if (ev.data[3]) consl.write(ev.data[3]);
            break;
        case 'Feedback':
            if (ev.data[1].contents[0] === 'Message')
                consl.write(ev.data[1].contents[3]);
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
    
    let sid = 4, stms = {};

    consl.on('data', (line) => {
        stms[++sid] = line;
        sendCommand(['Add', null, sid, line, false]);
    });

    consl.on('load-pkg', (ev) => worker.postMessage(['LoadPkg', ev.uri]));

    var pi = new PackageIndex().attach(worker);
    pi.populate();

    Object.assign(window, {worker, pi});
}



Object.assign(window, {main});
