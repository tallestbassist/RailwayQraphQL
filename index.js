const core = require('@actions/core');
const { request, gql, GraphQLClient } = require('graphql-request')

// Railway Required Inputs
const RAILWAY_API_TOKEN = '31c82fba-e045-4699-89b1-6acaec354f2b'
const PROJECT_ID = '93668177-79eb-4927-a7c7-f3d7147c42f5'
const SRC_ENVIRONMENT_NAME = core.getInput('SRC_ENVIRONMENT_NAME');
const SRC_ENVIRONMENT_ID = core.getInput('SRC_ENVIRONMENT_ID');
const DEST_ENV_NAME = 'graphqltest'//core.getInput('DEST_ENV_NAME');
const ENV_VARS = core.getInput('ENV_VARS');
const API_SERVICE_NAME = core.getInput('API_SERVICE_NAME');
const IGNORE_SERVICE_REDEPLOY = core.getInput('IGNORE_SERVICE_REDEPLOY');
const ENDPOINT = 'https://backboard.railway.app/graphql/v2';

const DELETE_ENV_BOOL = core.getInput('DELETE_ENV_BOOL');
const DELETE_ENV_ID = core.getInput('DELETE_ENV_ID');
const GET_ENV_ID = core.getInput('GET_ENV_ID');
const GET_END_ID_NAME = 'graphqltest' //core.getInput('GET_END_ID_NAME');

const ENVIRONMENT_ID_OUT = process.env.ENVIRONMENT_ID_OUT;

async function railwayGraphQLRequest(query, variables) {
    const client = new GraphQLClient(ENDPOINT, {
        headers: {
            Authorization: `Bearer ${RAILWAY_API_TOKEN}`,
        },
    })
    try {
        return await client.request({ document: query, variables })
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }
}

async function run() {

    //await createEnvironment('8f5f029d-db24-4089-a4fb-12a6f199228b')

    if (DELETE_ENV_BOOL === 'true')  {
        await deleteEnvironment(DELETE_ENV_ID)
    }


   // if (GET_ENV_ID === 'true') {

        let response = await getEnvironments()

        console.log(response.environments.edges.length)

        for (let i = 0; i < response.environments.edges.length; i++) {
            console.log(response.environments.edges[i].node)
            if (GET_END_ID_NAME === response.environments.edges[i].node.name) {
                ENVIRONMENT_ID_OUT = response.environments.edges[i].node.id
            }
        }
    //}

}

run();

async function getEnvironments() {
    let query =
        `query environments($projectId: String!) {
            environments(projectId: $projectId) {
                edges {
                    node {
                        id
                        name
                        deployments {
                            edges {
                                node {
                                    id
                                    status
                                }
                            }
                        }
                        serviceInstances {
                            edges {
                                node {
                                    id
                                    domains {
                                        serviceDomains {
                                            domain
                                        }
                                    }
                                    serviceId
                                    startCommand
                                }
                            }
                        }
                    }
                }
            }
        }`

    const variables = {
        "projectId": PROJECT_ID,
    }

    return await railwayGraphQLRequest(query, variables)
}

async function deleteEnvironment(EnvironmentID) {
    console.log("Deleting Environment... Environment ID:", EnvironmentID)

    try {
        let query = gql`
            mutation environmentDelete($id: String!) {
                environmentDelete(id: $id)
            }
        `
        const variables = {
            "id": EnvironmentID,
        }
        return await railwayGraphQLRequest(query, variables);
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }

}



async function createEnvironment(sourceEnvironmentId) {
    console.log("Creating Environment... based on source environment ID:", sourceEnvironmentId)
    try {
        let query = gql`
        mutation environmentCreate($input: EnvironmentCreateInput!) {
            environmentCreate(input: $input) {
                id
                name
                createdAt
                deploymentTriggers {
                    edges {
                        node {
                            id
                            environmentId
                            branch
                            projectId
                        }
                    }
                }
                serviceInstances {
                    edges {
                        node {
                            id
                            domains {
                                serviceDomains {
                                    domain
                                    id
                                }
                            }
                            serviceId
                        }
                    }
                }
            }
        }
        `
        const variables = {
            input: {
                "name": DEST_ENV_NAME,
                "projectId": PROJECT_ID,
                "sourceEnvironmentId": sourceEnvironmentId
            }
        }
        return await railwayGraphQLRequest(query, variables);
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }
}