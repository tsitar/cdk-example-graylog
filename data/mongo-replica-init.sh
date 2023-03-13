#! /bin/bash

CLUSTER_IP_ARR=( {{CLUSTER_IPS_ARRAY}} )

  timeout=60
  while true; do
    if [[ "$(cat /tmp/mongoInit)" == "initDone" ]]; then
      break
    else
      if (( ${timeout} <= 0 )); then
        echo "ERROR: Timeout reached. Terminating job." >>/var/log/mongodb/mongo-init.log
        exit 1
      else
        timeout=$((timeout-1))
        echo 'INFO: Waiting for script to finish MongoDB configuration.' >>/var/log/mongodb/mongo-init.log
        sleep 1
      fi
    fi
  done


# Initiate replica and add primary
echo "rs.initiate()" | mongosh -u admin -p admin --authenticationDatabase admin >>/var/log/mongodb/mongo-init.log 2>&1


# Add secondaries
for ip in ${CLUSTER_IP_ARR[@]}; do
    echo "rs.add(\"${ip}\")" | mongosh -u admin -p admin --authenticationDatabase admin >>/var/log/mongodb/mongo-init.log 2>&1
done

# Print out the replica set status
echo "rs.status()" | mongosh -u admin -p admin --authenticationDatabase admin >>/var/log/mongodb/mongo-init.log 2>&1
