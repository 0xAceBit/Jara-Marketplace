import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function test() {
    const tasks = await pb.collection('tasks').getFullList();

    console.log(tasks);
}

test();