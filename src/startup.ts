// parcel watch --hmr-hostname=localhost --public-url '.' src/index.html &

import { InteractiveConsole } from './ui/console';


function main() {
    var worker = new Worker('./worker.ts');


    function sendCommand(cmd) {
        worker.postMessage(JSON.stringify(cmd));
    }

    var consl = new InteractiveConsole();

    worker.addEventListener('message', (ev) => {
        console.log(ev.data);

        switch (ev.data[0]) {
        case 'Starting':
            consl.showProgress('Starting', false);  break;
        case 'Boot':
            sendCommand(['Init']); break;
        case 'Ready':
            consl.showProgress('Starting', true);  break;
        case 'Added':
            sendCommand(["Goals", ev.data[1]]); break;
        case 'GoalInfo':
            for (let g of ev.data[1]) consl.write(g);  break;
        case 'CoqExn':
            if (ev.data[1]) consl.write(ev.data[1]);
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
    
    consl.on('data', (line) => sendCommand(["Add", line]));

    Object.assign(window, {worker});
}



Object.assign(window, {main});
