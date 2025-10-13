![Logo](https://i.imgur.com/Bv2oKQY.png)
# (WIP) mcmp - moodpatcher's container-management platform
mcmp is a simple and lightweight tool for managing Docker-based environments and containers. Using an agentless SSH approach, it allows you to easily access and manage multiple nodes.
## Features: <br/>
- Web-based interface
- Network management
- Volume management
- Container management
- Power saving through scheduled shutdowns and startups
- Multi-node container management
- Basic node monitoring

## Usage:
Configuration files are located in **mcmp/config**. Here, you can add SSH-RSA keys, which the tool uses to connect to nodes via SSH, manage users, and handle node operations.
You can start the tool with deploy.sh.

## Adding users:
You can create users by generating a key with key.sh and placing it in **mcmp/config/users/<username>**. Be sure to save the key using the username you want to log in with.
```bash 
./key.sh > mcmp/config/users/root
```
After creating the key and placing it in the users folder, make sure to also save a copy on your computer. When logging in, you can either drag and drop the key or select it after entering your username.
## Adding hosts (regions):
Add an SSH-RSA private key that the tool can use to log into your systems by placing it in the **mcmp/config/rsa-keys** directory. 
Then, add hosts (regions) by listing them in **mcmp/config/nodes**, following the existing format defined in the file. For example:
```bash 
# Node name, Node IP, docker/podman, keyfile, user
debian 127.0.0.1 docker id_rsa mcmp
```
NOTE: Podman support hasn’t been implemented yet, but you can still use it by setting an alias. <br/>