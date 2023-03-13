#! /bin/bash

setup_mongo() {
  install_packages
  set_config_file
  set_access_roles
  enable_replicaset
}


install_packages() {
  # update list of packages
  yum -y update

  # just for some convenient debugging
  yum install telnet nc -y

  echo '[mongodb-org-6.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/amazon/2/mongodb-org/6.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-6.0.asc' > /etc/yum.repos.d/mongodb-org-6.0.repo

  yum -y update
  yum install -y mongodb-org
}


set_config_file() {
  echo '# mongod.conf

# for documentation of all options, see:
#   http://docs.mongodb.org/manual/reference/configuration-options/

# Where and how to store data.
storage:
  dbPath: /var/lib/mongo
  journal:
    enabled: true

# where to write logging data.
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

# network interfaces
net:
  port: 27017
  bindIp: 0.0.0.0

# how the process runs
processManagement:
  fork: true
  pidFilePath: /var/run/mongodb/mongod.pid
' > /etc/mongod.conf

  systemctl restart mongod
  wait_for_process_startup
}


set_access_roles() {
  echo 'db.createUser({ user: "admin", pwd: "admin", roles: [ { role: "root", db: "admin" }  ] });' | mongosh admin 
  echo 'disableTelemetry()' | mongosh admin -u admin -p admin >>/var/log/mongodb/mongo-init.log 2>&1
  echo 'db.createUser({user: "gray",pwd: "gray",roles: [ { role: "readWrite", db: "graylog" } ] });' | mongosh graylog -u admin -p admin --authenticationDatabase admin >>/var/log/mongodb/mongo-init.log 2>&1
  echo 'disableTelemetry()' | mongosh admin -u admin -p admin --authenticationDatabase admin >>/var/log/mongodb/mongo-init.log 2>&1
}


enable_replicaset() {
echo 'security:
  authorization: enabled
  keyFile: /opt/mongod/keyfile
replication:
  replSetName: rs0
' >> /etc/mongod.conf

  mkdir -p /opt/mongod

  echo '9xMW4Z01498aODDgrSKlxyvoV+JPzp7z82yGmrCvHLYzsQP9CJrBAs1O59w0M5ml
  I4jPZFd9Pp3RbJMX+VeWjy5bM/miS0hRUduFF9V4vP0sobjn762m3qA7QHjSp9gc
  HajrYIrw4j9lceOMTvRZ49SzMttnXfsmQ1vv00i2z6mdBksRHvnbKjwKKdBvnNQf
  dgOEoGr6LN2qANxUqKm3fHJs/OUrZrHVtSOmb/DZelAZrEub92PszWtNiu/21MSc
  zybzw8F914wtDn934IsyPEzBlmQnEg/JQQ4UYluHLd5QUR66COuVZns7JphJPjE/
  5GJx5UC1/zY+nZ/OBj85B+/y4YlZ0ByOZEC5udVXU2kNEkRG90Z4iVMH2zS54Iyl
  nKAN0r0R229WnwnjmtMUd1mUHF8H3j6Zde1t7oWAZmYW+3Tc8XWp/nZcyeYUOjT0
  L1wSng0pLjB+TZzbsfT/jsBPEDr45Ht76QZxNURTs5TEZa67ejD7IfCB3jrrN19u
  oxhlV77qFlWt9eWQdg1h7n5x/WP7NIItPgTT+BRMHRbAx9Rd5Nmc8jNQeCK4cH28
  1kEIBx5xYflcO9dDNYrkVyGaiw1l+lmYINcklR0PtLyhXgDUF/V6dKjXtp5EjcHG
  RJOdHyuYlVcINbbwqCRkyw1ri8qDsHo73imVSiFAm4msY4J6aZXd50CztQY6JqNO
  htC8H4LtydB9jo7RQXo+uCotqK5JLi424v1rWnt6NDb91DmKv75sH/GYV732MChX
  j6BLzbE6huIDXAB4cJvl2xQnYozC63gb2RjVUSp7cxvBNwgmde0Url29puXxcZHb
  eSJOQEkuEE+KTE2W85H/ivksb4pyge05LHffoBs1+izrkYWkiMfC5tjwot96EdH6
  RpVAqAvvALoUnA/hAb3Y4raI9L6g7QnxN3zQXDKe4BWfxbHYOt1HTUT85z6PNZxJ
  UoBs7m79ZbadBfhJzc3yZ/rJhegG' > /opt/mongod/keyfile
  chown mongod:mongod '/opt/mongod/keyfile'
  chmod 600 '/opt/mongod/keyfile'

  systemctl restart mongod
  wait_for_process_startup
}


wait_for_process_startup() {
  timeout=60
  while true; do
    if [[ $(systemctl status mongod | grep "active (running)") != "" ]]; then
      break
    else
      if (( ${timeout} <= 0 )); then
        echo "ERROR: Timeout reached. Terminating job." >>/var/log/mongodb/mongo-init.log
        exit 1
      else
        timeout=$((timeout-1))
        echo 'INFO: Waiting for MongoDB first start-up to configure user and database.' >>/var/log/mongodb/mongo-init.log
        sleep 1
      fi
    fi
  done
}

setup_mongo

echo "initDone" > /tmp/mongoInit
