#!/bin/sh

if [ ! -f /mcmp/mcmp/package.json ]; then
    git clone https://github.com/moodpatcher/mcmp.git /tmp/mcmp;

    cp -r /tmp/mcmp/* /mcmp;
    rm -rf /tmp/mcmp;

    cd /mcmp/mcmp;

    rm -rf /mcmp/deploy.sh;
    chmod +x /mcmp/key.sh;

    # Generating root user key
    USER="root"
    USER_KEY=$(/mcmp/key.sh)

    echo;
    echo ===============================================================================
    echo "A key has been created for user $USER and added to MCMP."
    echo "Make sure to save a copy on your machine as well, which you can use to log in."
    echo /mcmp/$USER.mcmp-key
    echo ===============================================================================
    echo $USER_KEY > /mcmp/mcmp/config/users/$USER
    echo $USER_KEY > /mcmp/$USER.mcmp-key
    echo;

    npm install --production;
fi

cd /mcmp/mcmp
exec npm run start