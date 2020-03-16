// parcel watch --hmr-hostname=localhost --public-url '.' src/index.html src/worker.ts &

import { InteractiveConsole } from './ui/console';


function main() {
    var startTime = +new Date();

    var worker = new Worker(0 || './worker.js');  // bypass Parcel (fails to build worker at the moment)


    function sendCommand(cmd) {
        worker.postMessage(JSON.stringify(cmd));
    }

    var consl = new InteractiveConsole();

    worker.addEventListener('message', (ev) => {
        console.log(ev.data);

        switch (ev.data[0]) {
        case 'Starting':
            console.log(`%cStarting (+${+new Date() - startTime}ms)`, 'color: #99f');
            consl.showProgress('Starting', false);  break;
        case 'Boot':
            console.log(`%cBoot (+${+new Date() - startTime}ms)`, 'color: #99f');
            sendCommand(['Init']); break;
        case 'Ready':
            consl.showProgress('Starting', true);
            console.log(`%cReady (+${+new Date() - startTime}ms)`, 'color: #99f');
            sendCommand(['Add', null, null, 'Check nat.']);
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
        case 'Progress':
            var e = ev.data[1];
            if (e.content.uri) consl.showProgress(e.content.uri, e.done,
                `Downloading ${e.content.uri}...`);
            break;
        }
    });
    
    consl.on('data', (line) => sendCommand(["Add", null, null, line]));

    Object.assign(window, {worker});
}



Object.assign(window, {main});
