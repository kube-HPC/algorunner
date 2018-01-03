const store = {
    "name": "bigevaltest",
    "nodes": [
        {
            "nodeName": "evaladd",
            "algorithmName": "eval-alg",
            "input": [
                [
                    "(input,require)=> {",
                    "const result= input[0][0]+input[0][1]",
                    "return [result];}"
                ],
                "@flowInput.addInput"
            ]
        },
        {
            "nodeName": "evalmul",
            "algorithmName": "eval-alg",
            "input": [
                [
                    "(input,require)=> {",
                    "const result = input[0][0]*input[1]",
                    "return result;}"
                ],
                "@flowInput.multInput",
                "@evaladd"
            ]
        }
    ],
    "webhooks": {
        "progress": "string",
        "result": "string"
    },
    "options": {
        "batchTolerance": 80,
        "progressVerbosityLevel": "info"
    }
}

const execute = {
    "name": "bigevaltest",
    "flowInput":{
        "addInput":[4,5],
        "multInput":[4]
    },
    "options": {
        "batchTolerance": 60,
        "progressVerbosityLevel": "info"
    }
}