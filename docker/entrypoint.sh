#!/bin/sh

find /mcmp/mcmp -mindepth 1 -maxdepth 1 -type d ! -name 'config' -exec rm -rf {} +

git clone https://github.com/moodpatcher/mcmp.git /tmp/mcmp;

# Deleting config files to prevent existing ones from being overwritten
files="
mcmp/config/nodes
mcmp/config/power-saving-schedules.json
";

for file in $files; do
    if [ -f "/mcmp/$file" ]; then
        rm -rf "/tmp/mcmp/$file"
    fi
done

cp -r /tmp/mcmp/* /mcmp;
rm -rf /tmp/mcmp;

cd /mcmp/mcmp;

rm -rf /mcmp/deploy.sh;

npm install --production;

# Generating root user key
if [ ! -f /mcmp/mcmp/config/users/root ]; then
    chmod +x /mcmp/key.sh;

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
fi

cd /mcmp/mcmp
exec npm run start