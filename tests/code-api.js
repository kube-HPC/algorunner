const { expect } = require('chai');

const algorunner = require('../lib/algorunner');
const configIt = require('@hkube/config');
const { main, logger } = configIt.load();
const config = main;


xdescribe('Test', function () {
    before(async () => {

    });
    describe('SubPipeline', function () {
        it('should start sub pipeline', async function () {
            const subPipeline = {
                name: 'simple'
            }
            algorunner._clean();
            const response = await algorunner.startSubPipeline(subPipeline);
            expect(response.error).to.equal('build id is required');
            expect(response.status).to.equal('failed');
            expect(response).to.have.property('buildId');
            expect(response).to.have.property('error');
            expect(response).to.have.property('status');
            expect(response).to.have.property('result');
        });
    });
});
