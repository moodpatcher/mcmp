GitHub page: https://github.com/moodpatcher/mcmp

# mcmp - moodpatcher's container-management platform
mcmp is a simple and lightweight tool for managing Docker-based environments and containers. Using an agentless SSH approach, it allows you to easily access and manage multiple nodes. 
## ⚠️ Work In Progress
This project is still a work in progress. Some features may be incomplete, and you may encounter bugs. Using it in production environments is highly not recommended.
## Features:
- Web-based interface
- Network management
- Volume management
- Container management
- Power saving through scheduled shutdowns and startups
- Multi-node container management
- Basic node monitoring

## Usage:
Configuration files are located in **[volume]/mcmp/config**. Here, you can add SSH-RSA keys, which the tool uses to connect to nodes via SSH, manage users, and handle node operations.
```
docker run -it --name mcmp -p 8080:8080 -v $PWD/mcmp:/mcmp mcmp
```

## Adding users:
By default, a root user is created, and a copy of their login key is stored in **[volume]/root.mcmp-key**.<br/> <br/>
You can create users by generating a key with key.sh and placing it in **[volume]/mcmp/config/users/<username>**. Be sure to save the key using the username you want to log in with.
```bash 
./key.sh > mcmp/config/users/root
```
After creating the key and placing it in the users folder, make sure to also save a copy on your computer. When logging in, you can either drag and drop the key or select it after entering your username.
## Adding hosts (regions):
Add an SSH-RSA private key that the tool can use to log into your systems by placing it in the **[volume]/mcmp/config/rsa-keys** directory. 
Then, add hosts (regions) by listing them in **[volume]/mcmp/config/nodes**, following the existing format defined in the file. For example:
```bash 
# Node name, Node IP, docker/podman, keyfile, user
debian 127.0.0.1 docker id_rsa mcmp
```
NOTE: Podman support hasn’t been implemented yet, but you can still use it by setting an alias. <br/>
## Adding templates:
Templates make it easier to deploy containers. You can create your own templates and deploy them by placing them in the **[volume]/mcmp/config/templates** directory. Example template:
```js
{
    "name": "Example",
    "description": "Short description",
    "long_description": "Long description of the template.",
    "icon": "https://i.imgur.com/Bv2oKQY.png",
    "folder": "example",
    "variables": ["variable_1:World", "variable_2"],
    "cmds": [
        "echo Hello ${variable_1}! Value for variable_2 is: ${variable_2}"
    ]
}
```
## Planned Features:
- Volume migration between regions
- Logging
- User access control