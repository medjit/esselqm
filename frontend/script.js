//navibar
document.getElementById('hamburger-button').addEventListener('click', function() {
    const navibar = document.getElementById('navibar');
    navibar.classList.toggle('hidden');
    document.getElementById('main-content').classList.toggle('expanded');
});


window.addEventListener('load', function() {
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        const folder = 'audio'; // Define the folder variable
        fetch(`/get_folder?folder=${encodeURIComponent(folder)}`)
            .then(response => response.json())
            .then(data => {
                populateAudioBoxes(data);
                console.log(data);
            })
            .catch(error => console.error('Error fetching folder data:', error));
    }
});

function populateAudioBoxes(data) {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = ''; // Clear any existing content

    data.forEach(item => {
        const thumbnail = item.thumbnailBase64 ? `data:image/png;base64,${item.thumbnailBase64}` : 'default-thumbnail.png';
        const audioBox = createAudioBox(thumbnail, item.theme, item.author, item.size, item.duration, item.url);
        mainContent.appendChild(audioBox);
    });
}

function createAudioBox(thumbnail, theme, author, fileSize, duration, open_address) {
    const box = document.createElement('div');
    box.classList.add('audio-box');
    box.style.cursor = 'pointer';
    box.addEventListener('click', function() {
        window.location.href = open_address;
    });

    const img = document.createElement('img');
    img.src = thumbnail;
    img.alt = theme;
    img.style.maxWidth = '100%'; // Ensure the image does not exceed the width of the audio-box
    img.style.maxHeight = '100%'; // Ensure the image does not exceed the height of the audio-box
    img.style.objectFit = 'contain'; // Ensure the image fits within the box without cropping
    img.style.display = 'block'; // Ensure the image is displayed as a block element
    img.style.margin = '0 auto'; // Center the image horizontally
    box.appendChild(img);

    const themeElement = document.createElement('p');
    themeElement.textContent = `Theme: ${theme}`;
    box.appendChild(themeElement);

    const authorElement = document.createElement('p');
    authorElement.textContent = `Author: ${author}`;
    box.appendChild(authorElement);

    const fileSizeElement = document.createElement('p');
    fileSizeElement.textContent = `File Size: ${fileSize}`;
    box.appendChild(fileSizeElement);

    const durationElement = document.createElement('p');
    durationElement.textContent = `Duration: ${duration}`;
    box.appendChild(durationElement);

    return box;
}

//================ audio player =================
if (window.location.pathname.endsWith('audioplayer.html')) {
    const urlParams = new URLSearchParams(window.location.search);
    const audioFile = urlParams.get('file');

    if (audioFile) {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = ''; // Clear any existing content

        const audioPlayer = document.createElement('audio');
        audioPlayer.controls = true;
        audioPlayer.autoplay = true;
        audioPlayer.src = decodeURIComponent(audioFile);
        audioPlayer.style.width = '80%'; // Make the audio player take the full width of the container

        mainContent.appendChild(audioPlayer);

        // Throttle requests to the server
        let lastRequestTime = 0;
        const throttleInterval = 1000; // 1 second

        audioPlayer.ontimeupdate = function() {
            const currentTime = Date.now();

            if (currentTime - lastRequestTime > throttleInterval) {
                // Only send a request if more than 1 second has passed
                console.log("Send request to server now...");
                lastRequestTime = currentTime;
            }
        };
    } else {
        console.error('No audio file specified in the query parameters.');
    }
}
//---------------- audio player -----------------