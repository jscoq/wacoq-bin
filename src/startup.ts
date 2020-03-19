// parcel watch --hmr-hostname=localhost --public-url '.' src/index.html src/worker.ts &

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
            sendCommand(['Init']); break;
        case 'Ready':
            milestone('Ready');
            consl.showProgress('Starting', {done: true});
            sendCommand(['Add', null, null, 'Check nat.', true]);
            break;
        case 'Added':
            sendCommand(['Exec', ev.data[1]]);
            sendCommand(['Goals', ev.data[1]]); break;
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
            if (e.content.uri) consl.showProgress(e.content.uri, e,
                `Downloading ${e.content.uri}...`);
            break;
        }
    });
    
    consl.on('data', (line) => sendCommand(['Add', null, null, line, true]));

    consl.on('load-pkg', (ev) => worker.postMessage(['LoadPkg', ev.uri]));

    Object.assign(window, {worker});
}



Object.assign(window, {main});
