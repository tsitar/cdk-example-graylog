#! /bin/bash

CLUSTER_IP_ARR=( {{CLUSTER_IPS_ARRAY}} )

replica_init() {
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
  mongosh -u admin -p admin --eval "EJSON.stringify( rs.initiate() );" --authenticationDatabase admin --quiet -norc

  # Add secondaries
  for ip in ${CLUSTER_IP_ARR[@]}; do
    mongosh -u admin -p admin --eval "EJSON.stringify( rs.add(\"${ip}\") );" --authenticationDatabase admin --quiet -norc
  done

  # Print out the replica set status
  mongosh -u admin -p admin --eval "EJSON.stringify( rs.status() );" --authenticationDatabase admin --quiet -norc
}

replica_init