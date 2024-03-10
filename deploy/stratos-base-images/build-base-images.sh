#!/bin/bash
set -e

# Colours
CYAN="\033[96m"
YELLOW="\033[93m"
RESET="\033[0m"
BOLD="\033[1m"

BASE_IMAGE=rockylinux:9
REGISTRY=ghcr.io
ORGANIZATION=shono09835
TAG=rockylinux9
ARCH=amd64
PROG=$(basename ${BASH_SOURCE[0]})
SQUASH_ARGS="--squash"
NO_SQUASH="stratos-base"
DIR=$(dirname $PROG)

NODE_ARCH=x64
GO_ARCH=amd64
MARIADB_ARCH=rocky9-amd64
GOSU_ARCH=amd64
NGINX_ARCH=rocky/9/x86_64

function usage {
    echo "usage: $PROG [-b BASE] [-r REGISTRY] [-o ORGANIZATION] [-t TAG] [-s] [-p] [h]"
    echo "       -a Value   System Architecture (amd64 or arm64)"
    echo "       -b Value   Base Image"
    echo "       -r Value   Docker registry"
    echo "       -o Value   Organization in Docker registry"
    echo "       -s         Don't squash images"
    echo "       -t Value   Tag for images"
    echo "       -p         Push images to registry"
    echo "       -h         Help"
    exit 1
}


while getopts "a:b:r:o:t:ph:s" opt ; do
    case $opt in
        a)
            ARCH=${OPTARG}
            case $ARCH in
                amd64)
                    ;;
                arm64)
                    NODE_ARCH=arm64
                    GO_ARCH=arm64
                    MARIADB_ARCH=rocky9-aarch64
                    GOSU_ARCH=arm64
                    NGINX_ARCH=rocky/9/aarch64
                    ;;
                *)
                    echo "Invalid architecture $OPTARG" >&2
                    usage
                    ;;
            esac
            ;;
        b)
            BASE_IMAGE=${OPTARG}
            ;;
        r)
            REGISTRY=${OPTARG}
            ;;
        o)
            ORGANIZATION=${OPTARG}
            ;;
        t)
            TAG=${OPTARG}
            ;;
        p)
            PUSH_IMAGES=true
            ;;
        h)
            usage
            ;;
        s)
            SQUASH_ARGS=""
            ;;
        \?)
            echo "Invalid option -$OPTARG" >&2
            usage
            ;;
    esac
done

printf "${YELLOW}"
echo "=========================="
echo "Stratos Base Image Builder"
echo "=========================="
printf "${CYAN}"
echo ""
echo "ARCHITECTURE : ${ARCH}"
echo "BASE IMAGE   : ${BASE_IMAGE}"
echo "REGISTRY     : ${REGISTRY}"
echo "ORG          : ${ORGANIZATION}"
echo "TAG          : ${TAG}"
echo "SQUASH:      : ${SQUASH_ARGS}"
echo "PUSH IMAGES  : ${PUSH_IMAGES}"
echo ""
printf "${RESET}"

if [ -z ${PUSH_IMAGES} ]; then
  echo "========================================"
  echo "Images will NOT be pushed"
  echo "========================================"
fi

set -x

__DIRNAME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_PATH=${__DIRNAME}/..

cd ${__DIRNAME}
DOCKERFILES=$(ls *.tmpl)
pushd $(mktemp -d)
curl -sSO https://raw.githubusercontent.com/tests-always-included/mo/master/mo
chmod +x mo

# Copy any scripts required by the docker files to the temporary folder
cp ${__DIRNAME}/install-ruby.sh .

GO_BUILD_BASE=${REGISTRY}/${ORGANIZATION}/stratos-go-build-base:${TAG}
for i in ${DOCKERFILES}; do
  BASE_IMAGE=${BASE_IMAGE} GO_BUILD_BASE=${GO_BUILD_BASE} ARCH=${ARCH} NODE_ARCH=${NODE_ARCH} GO_ARCH=${GO_ARCH} MARIADB_ARCH=${MARIADB_ARCH} GOSU_ARCH=${GOSU_ARCH} NGINX_ARCH=${NGINX_ARCH} ./mo ${__DIRNAME}/$i > ${i/.tmpl} 
done

pwd

build_and_push_image() {
    image_name=$1
    docker_file=$2
    set +x
    echo ""
    printf "${CYAN}========= >>>>${RESET}\n"
    printf "${CYAN}Building image ${YELLOW}${image_name}${CYAN} with docker file ${YELLOW}${docker_file}${RESET}\n"
    printf "${CYAN}========= >>>>${RESET}\n"
    echo ""

    # We can't squash base image as its the same as the base (just re-tagged)
    ARG=""
    if [ "${image_name}" != "$NO_SQUASH" ]; then
        ARG="${SQUASH_ARGS}"
    fi
    set -x
    # Always remove intermediate containers
    docker build --force-rm ${ARG} . -f $docker_file  -t ${REGISTRY}/${ORGANIZATION}/${image_name}:${TAG}
    if [ ! -z ${PUSH_IMAGES} ]; then
        docker push ${REGISTRY}/${ORGANIZATION}/${image_name}:${TAG}
    fi

    echo "${image_name}:${TAG}" >> $__DIRNAME/imagelist.txt
}

tag_and_push_image() {
    TAG_FROM=$1
    TAG_TO=$2
    set +x
    echo ""
    printf "${CYAN}========= >>>>${RESET}\n"
    printf "${CYAN}Tagging image ${YELLOW}${TAG_FROM}${CYAN} to ${YELLOW}${TAG_TO}${RESET}\n"
    printf "${CYAN}========= >>>>${RESET}\n"
    echo ""
    set -x
    docker tag ${REGISTRY}/${ORGANIZATION}/${TAG_FROM}:${TAG} ${REGISTRY}/${ORGANIZATION}/${TAG_TO}:${TAG}
    if [ ! -z ${PUSH_IMAGES} ]; then
        docker push ${REGISTRY}/${ORGANIZATION}/${TAG_TO}:${TAG}
    fi
}

# Create a manifest of all og the base images
rm -f $__DIRNAME/imagelist.txt
touch $__DIRNAME/imagelist.txt

# Plain OS image
build_and_push_image stratos-base Dockerfile.stratos-base

# Base with ruby
build_and_push_image stratos-ruby-base Dockerfile.stratos-ruby-base

# Build base with ruby
build_and_push_image stratos-ruby-build-base Dockerfile.stratos-ruby-build-base

# Base with go
build_and_push_image stratos-go-build-base Dockerfile.stratos-go-build-base

# Used building the UI (has node)
build_and_push_image stratos-ui-build-base Dockerfile.stratos-ui-build-base

# Used for running the backend
build_and_push_image stratos-bk-base Dockerfile.stratos-bk-base

# Used for hosting nginx
build_and_push_image stratos-nginx-base Dockerfile.stratos-nginx-base

# Used for stratos-jetstream-builder base
build_and_push_image stratos-bk-build-base Dockerfile.stratos-bk-build-base

# Used for building the DB image
build_and_push_image stratos-db-base Dockerfile.stratos-mariadb-base

# Used for building the init image
build_and_push_image stratos-bk-init-base Dockerfile.stratos-bk-init-base

# Used for building the AIO image
tag_and_push_image stratos-bk-build-base stratos-aio-base

rm -f mo;
