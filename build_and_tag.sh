#!/bin/bash
set -eu

# set the defaults for docker registry and tag
DOCKER_REGISTRY=docker-registry.helion.space:443
TAG=$(date -u +"%Y%m%dT%H%M%SZ")

while getopts ":r:t:" opt; do
  case $opt in
    r)
      DOCKER_REGISTRY="$OPTARG"
      ;;
    t)
      TAG="$OPTARG"
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      exit 1
      ;;
    :)
      echo "Option -$OPTARG requires an argument." >&2
      exit 1
      ;;
  esac
done

echo "Registry: $DOCKER_REGISTRY"
echo "Tag: $TAG"

echo "Starting build"

GROUP_NAME=helioncf
BUILD_ARGS=""
__DIRNAME="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

#BUILD_ARGS="--build-arg http_proxy=http://proxy.sdc.hp.com:8080"
#BUILD_ARGS="$BUILD_ARGS --build-arg https_proxy=http://proxy.sdc.hp.com:8080"

function buildAndPublishImage {
  # $1 is name
  # $2 is docker file name
  # $3 is folder name

  NAME=$1
  DOCKER_FILE=$2
  FOLDER=$3

  if [ ! -d "${FOLDER}" ]; then
    echo "Project ${FOLDER} hasn't been checked out";
    exit 1
  fi

  IMAGE_URL=${DOCKER_REGISTRY}/${GROUP_NAME}/${NAME}:${TAG}
  echo Building Docker Image for $NAME

  pushd ${FOLDER}
  pwd
  docker build ${BUILD_ARGS} -t $NAME -f $DOCKER_FILE .

  docker tag ${NAME} ${IMAGE_URL}

  echo Pushing Docker Image ${IMAGE_URL}
  docker push  ${IMAGE_URL}
  popd
}

# Cleanup the SDL/instance defs
rm -rf ${__DIRNAME}/output/*

# Cleanup prior to generating the UI container
rm -rf ${__DIRNAME}/../stratos-ui/dist
rm -rf ${__DIRNAME}/../stratos-ui/containers/nginx/dist

# Build Portal Proxy
# PORTAL_PROXY_PATH=$GOPATH/src/github.com/hpcloud/portal-proxy
# pushd ${PORTAL_PROXY_PATH}
# ./tools/build_portal_proxy.sh
# popd

# TODO (wchrisjohnson) document this and add a shell script to regenerate the
# image when necessary.
# Build the Proxy executable in a container, and leave it on the local filesystem
# Use the existing build container we created for the CI process
PORTAL_PROXY_PATH=$GOPATH/src/github.com/hpcloud/portal-proxy
pushd ${PORTAL_PROXY_PATH}
docker run -it \
           --rm \
           --name proxy-builder \
           --volume $(pwd):/go/src/github.com/hpcloud/portal-proxy \
           $DOCKER_REGISTRY/helioncf/proxy-builder
popd

# Build and publish the container image for the portal proxy
buildAndPublishImage hsc-proxy Dockerfile.UCP ${PORTAL_PROXY_PATH}

# Build the postgres configuration container
buildAndPublishImage hsc-database-creation Dockerfile.database.UCP ${PORTAL_PROXY_PATH}

# Prepare the nginx server
docker run --rm \
  -v ${__DIRNAME}/../stratos-ui:/usr/src/app \
  -v ${__DIRNAME}/../helion-ui-framework:/usr/src/helion-ui-framework \
  -w /usr/src/app \
  node:4.2.3 \
  /bin/bash ./provision.sh

# Copy the artifacts from the above to the nginx container
cp -R ${__DIRNAME}/../stratos-ui/dist ${__DIRNAME}/../stratos-ui/containers/nginx/dist

# Build and push an image based on the nginx container
buildAndPublishImage hsc-console Dockerfile.UCP ${__DIRNAME}/../stratos-ui/containers/nginx

echo "Creating service and instance definition"

mkdir -p ${__DIRNAME}/output
for FILE in ${__DIRNAME}/hcp_templates/*.json ; do
  ofile=${__DIRNAME}/output/$(basename $FILE)
  cat $FILE | sed s/{{TAG}}/$TAG/g | sed s/{{REGISTRY}}/$DOCKER_REGISTRY/g > $ofile
done

echo "Build complete. Tag is $TAG and UCP definitions are in ${__DIRNAME}/output/"
echo "The definitions are using registry: $DOCKER_REGISTRY and tag: $TAG"
echo "BE SURE TO UPDATE ANY ENV VARS IN YOUR instance.json FILE."
