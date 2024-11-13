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
const GET_ENV_ID_BOOL = core.getInput('GET_ENV_ID_BOOL');
const GET_END_ID_NAME = 'graphqltest' //core.getInput('GET_END_ID_NAME');

let ENVIRONMENT_ID_OUT = process.env.ENVIRONMENT_ID_OUT;

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
    try {
        // Get Environments to check if the environment already exists
        let response = await getEnvironments();


        if (DELETE_ENV_BOOL === 'true')  {
            await deleteEnvironment(DELETE_ENV_ID)
        }

        if (GET_ENV_ID_BOOL === 'true') {
            for (let i = 0; i < response.environments.edges.length; i++) {
                if (GET_END_ID_NAME === response.environments.edges[i].node.name) {
                    ENVIRONMENT_ID_OUT = response.environments.edges[i].node.id
                }
            }
        }




        // Filter the response to only include the environment name we are looking to create
        const filteredEdges = response.environments.edges.filter((edge) => edge.node.name === DEST_ENV_NAME);

        // If there is a match this means the environment already exists
        if (filteredEdges.length == 1) {
            throw new Error('Environment already exists. Please delete the environment via API or Railway Dashboard and try again.')
        }

        let srcEnvironmentId = SRC_ENVIRONMENT_ID;

        // If no source ENV_ID provided get Source Environment ID to base new PR environment from (aka use the same environment variables)
        if (!SRC_ENVIRONMENT_ID) {
            srcEnvironmentId = response.environments.edges.filter((edge) => edge.node.name === SRC_ENVIRONMENT_NAME)[0].node.id;
        }

        // Create the new Environment based on the Source Environment
        const createdEnvironment = await createEnvironment(srcEnvironmentId);
        console.log("Created Environment:")
        console.dir(createdEnvironment, { depth: null })

        const { id: environmentId } = createdEnvironment.environmentCreate;

        // Get all the Deployment Triggers
        const deploymentTriggerIds = [];
        for (const deploymentTrigger of createdEnvironment.environmentCreate.deploymentTriggers.edges) {
            const { id: deploymentTriggerId } = deploymentTrigger.node;
            deploymentTriggerIds.push(deploymentTriggerId);
        }

        // Get all the Service Instances
        const { serviceInstances } = createdEnvironment.environmentCreate;

        // Update the Environment Variables on each Service Instance
        await updateEnvironmentVariablesForServices(environmentId, serviceInstances, ENV_VARS);

        // Wait for the created environment to finish initializing
        console.log("Waiting 15 seconds for deployment to initialize and become available")
        await new Promise(resolve => setTimeout(resolve, 15000)); // Wait for 15 seconds

        // Set the Deployment Trigger Branch for Each Service
        await updateAllDeploymentTriggers(deploymentTriggerIds);

        const servicesToIgnore = JSON.parse(IGNORE_SERVICE_REDEPLOY)
        const servicesToRedeploy = [];

        // Get the names for each deployed service
        for (const serviceInstance of createdEnvironment.environmentCreate.serviceInstances.edges) {
            const { domains } = serviceInstance.node;
            const { service } = await getService(serviceInstance.node.serviceId);
            const { name } = service;

            if (!servicesToIgnore.includes(name)) {
                servicesToRedeploy.push(serviceInstance.node.serviceId);
            }

            if ((API_SERVICE_NAME && name === API_SERVICE_NAME) || name === 'app' || name === 'backend' || name === 'web') {
                const { domain } = domains.serviceDomains?.[0];
                console.log('Domain:', domain)
                core.setOutput('service_domain', domain);
            }
        }

        // Redeploy the Services
        await redeployAllServices(environmentId, servicesToRedeploy);
    } catch (error) {
        console.error('Error in API calls:', error);
        // Handle the error, e.g., fail the action
        core.setFailed('API calls failed');
    }
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

async function updateEnvironment(environmentId, serviceId, variables) {
    const parsedVariables = JSON.parse(variables);

    try {
        let query = gql`
        mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
            variableCollectionUpsert(input: $input)
        }
        `

        let variables = {
            input: {
                "environmentId": environmentId,
                "projectId": PROJECT_ID,
                "serviceId": serviceId,
                "variables": parsedVariables
            }
        }

        return await railwayGraphQLRequest(query, variables)
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }
}

async function updateEnvironmentVariablesForServices(environmentId, serviceInstances, ENV_VARS) {
    const serviceIds = [];

    // Extract service IDs
    for (const serviceInstance of serviceInstances.edges) {
        const { serviceId } = serviceInstance.node;
        serviceIds.push(serviceId);
    }

    try {
        // Create an array of promises for updating environment variables
        const updatePromises = serviceIds.map(serviceId =>
            updateEnvironment(environmentId, serviceId, ENV_VARS)
        );

        // Await all promises to complete
        await Promise.all(updatePromises);
        console.log("Environment variables updated for all services.");
    } catch (error) {
        console.error("An error occurred during the update:", error);
    }
}

async function redeployAllServices(environmentId, servicesToRedeploy) {
    try {
        // Create an array of promises for redeployments
        const redeployPromises = servicesToRedeploy.map(serviceId =>
            serviceInstanceRedeploy(environmentId, serviceId)
        );

        // Await all promises to complete
        await Promise.all(redeployPromises);
        console.log("All services redeployed successfully.");
    } catch (error) {
        console.error("An error occurred during redeployment:", error);
    }
}

async function getService(serviceId) {
    let query =
        `query environments($id: String!) {
            service(id: $id) {
                name
                }
        }`

    const variables = {
        "id": serviceId,
    }

    return await railwayGraphQLRequest(query, variables)
}

async function updateAllDeploymentTriggers(deploymentTriggerIds) {
    try {
        // Create an array of promises
        const updatePromises = deploymentTriggerIds.map(deploymentTriggerId =>
            deploymentTriggerUpdate(deploymentTriggerId)
        );

        // Await all promises
        await Promise.all(updatePromises);
        console.log("All deployment triggers updated successfully.");
    } catch (error) {
        console.error("An error occurred during the update:", error);
    }
}
