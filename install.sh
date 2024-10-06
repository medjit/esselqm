#!/bin/bash

# Run commands with error handling
sudo apt-get update || { echo "Failed to update packages"; exit 1; }
sudo apt-get upgrade -y || { echo "Failed to upgrade packages"; exit 1; }
sudo apt-get install -y nodejs git || { echo "Failed to install Node.js and Git"; exit 1; }

# Create and start systemd service
#cat <<EOF | sudo tee /etc/systemd/system/esselqm.service
#[Unit]
#Description=Esselqm Node.js Server
#Documentation=https://example.com/docs

#[Service]
#Type=simple
#ExecStart=/usr/bin/node $(pwd)/server.js
#Restart=always
#RestartSec=10

#[Install]
#WantedBy=multi-user.target
#EOF

# Reload systemd and start the service
#sudo systemctl daemon-reload
#sudo systemctl enable esselqm.service
#sudo systemctl start esselqm.service

echo "Setup completed successfully."

