import json, os, uuid
from datetime import datetime, timezone
import httpx
from .engine import simulate, compare, trace, INTERVENTIONS
from . import ml
TOOLS={
'getScenario':'Read scenario, prediction provenance and assumptions',
'getModelMetadata':'Read trained model evaluation and limitations',
'getAffectedBuildings':'Inspect sampled disrupted facilities',
'getPrediction':'Retrieve asset risk and scenario evidence',
'getPredictionDrivers':'Retrieve model coefficients and asset assumptions',
'getGraphNode':'Inspect an infrastructure node',
'traceDependencies':'Trace upstream and downstream dependencies',
'runImpactAnalysis':'Calculate financial and community impact',
'calculateBusinessImpact':'Calculate scenario losses',
'calculateCommunityNeeds':'Calculate shelter shortage and service gaps',
'findAlternativeResources':'Inspect verified synthetic shelter alternatives',
'getAvailableInterventions':'Read intervention costs and prerequisites',
'simulateIntervention':'Preview counterfactual without applying it',
'submitPlanForApproval':'Submit proposed actions for human review'}

def investigate(prompt,severity,seed):
    scenario=simulate(severity,seed); calls=[]; proposed=[]
    def call(name,args):
        if name not in TOOLS: return {'error':'unknown tool'}
        aid=args.get('assetId','B005'); assets={a['id']:a for a in scenario['assets']}
        if name=='getScenario': result={k:v for k,v in scenario.items() if k not in ['assets','edges','businesses','community']}
        elif name=='getModelMetadata': result=ml.metadata()
        elif name=='getAffectedBuildings':result=[a for a in scenario['assets'] if a['failed']]
        elif name in ('getPrediction','getGraphNode'):result=assets.get(aid,{'error':'unknown asset'})
        elif name=='getPredictionDrivers':result={'asset':assets.get(aid),'eventPrediction':scenario['prediction'],'assumptions':scenario['assumptions']}
        elif name=='traceDependencies':result={'assetId':aid,'upstream':trace(aid),'downstream':trace(aid,'downstream')}
        elif name=='runImpactAnalysis':result={'business':scenario['business'],'community':scenario['community']}
        elif name=='calculateBusinessImpact':result=scenario['business']
        elif name=='calculateCommunityNeeds':result=scenario['community']
        elif name=='findAlternativeResources':result=scenario['community']['shelters']
        elif name=='getAvailableInterventions':result=INTERVENTIONS
        elif name=='simulateIntervention':
            ids=args.get('interventionIds') or [args.get('interventionId','power')]
            result=compare(severity,seed,ids) if not set(ids)-{i['id'] for i in INTERVENTIONS} else {'error':'unknown intervention'}
            if 'baseline' in result:result={'interventionIds':ids,'avoidedLoss':result['avoidedLoss'],'netBenefit':result['netBenefit'],'remainingUnmetNeeds':result['mitigated']['community']['unmetShelterDemand'],'remainingServiceGaps':result['mitigated']['community']['serviceGaps'],'baselineUnmetNeeds':scenario['community']['unmetShelterDemand']}
        else:
            ids=[i for i in args.get('interventionIds',[]) if i in {a['id'] for a in INTERVENTIONS}]
            proposed[:]=ids;result={'status':'pending','interventionIds':ids,'humanApprovalRequired':True}
        calls.append({'id':str(uuid.uuid4()),'name':name,'arguments':args,'result':result,'timestamp':datetime.now(timezone.utc).isoformat()});return result
    key=os.getenv('NVIDIA_API_KEY'); mode='NVIDIA Nemotron' if key else 'Demo Agent'; message=''
    if key:
        schemas=[{'type':'function','function':{'name':name,'description':desc,'parameters':{'type':'object','properties':{'assetId':{'type':'string'},'interventionId':{'type':'string'},'interventionIds':{'type':'array','items':{'type':'string'}}},'additionalProperties':False}}} for name,desc in TOOLS.items()]
        messages=[{'role':'system','content':'You investigate a fictional disaster scenario. Use tools for every numerical claim. Prioritize human needs independently of property values. Never imply real dispatch. Call scenario, impact, dependencies and intervention preview tools before submitting a plan. Explain uncertainties. Submit only simulated interventions for human approval.'},{'role':'user','content':prompt}]
        try:
            with httpx.Client(timeout=90) as client:
                for _ in range(8):
                    r=client.post('https://integrate.api.nvidia.com/v1/chat/completions',headers={'Authorization':'Bearer '+key},json={'model':os.getenv('NVIDIA_MODEL','nvidia/llama-3.3-nemotron-super-49b-v1.5'),'messages':messages,'tools':schemas,'temperature':.2,'max_tokens':1800});r.raise_for_status();msg=r.json()['choices'][0]['message'];messages.append(msg)
                    if not msg.get('tool_calls'):message=msg.get('content') or '';break
                    for tc in msg['tool_calls']:
                        try:args=json.loads(tc['function']['arguments']);result=call(tc['function']['name'],args)
                        except (ValueError,TypeError):result={'error':'invalid tool arguments'}
                        messages.append({'role':'tool','tool_call_id':tc['id'],'content':json.dumps(result)})
            if not calls:raise RuntimeError('No tools executed')
            if not message:message='Investigation reached its tool-call budget. Review the recorded evidence and pending proposal; no final narrative was returned.'
        except (httpx.HTTPError,KeyError,RuntimeError) as e:
            return {'mode':'NVIDIA unavailable','error':type(e).__name__,'summary':'Nemotron request failed. Remove the key to use the labeled Demo Agent.','toolCalls':calls,'plan':None}
    else:
        call('getScenario',{});call('getModelMetadata',{});call('getAffectedBuildings',{});call('traceDependencies',{'assetId':'B005'});call('calculateBusinessImpact',{});call('calculateCommunityNeeds',{});call('getAvailableInterventions',{})
        candidates=[['power'],['shelter'],['road'],['medication'],['power','shelter'],['power','road','shelter'],['power','road','shelter','medication']]
        previews=[call('simulateIntervention',{'interventionIds':ids}) for ids in candidates]
        # Evaluate combinations: shelter activation alone may be blocked by power or access.
        ranked=sorted(previews,key=lambda p:(p['remainingUnmetNeeds'],len(p['remainingServiceGaps']),-p['netBenefit']))
        ids=ranked[0]['interventionIds']
        call('submitPlanForApproval',{'interventionIds':ids})
        message=f"The seeded scenario leaves {scenario['community']['unmetShelterDemand']} shelter spaces unmet and {len(scenario['community']['serviceGaps'])} essential-service categories interrupted. Start with verified shelter and access capacity where the previews reduce unmet needs. The pharmacy depends on the substation and an access road; restoring only one may leave it disrupted. Financial exposure is ${scenario['business']['totalModeledLoss']:,.0f}. Review the counterfactuals below before approving simulated changes. This is deterministic Demo Agent analysis, not Nemotron inference."
    plan={'planId':str(uuid.uuid4()),'summary':message,'scenarioId':scenario['id'],'severity':severity,'seed':seed,'interventionIds':proposed,'approvalStatus':'pending','createdAt':datetime.now(timezone.utc).isoformat(),'uncertainties':ml.LIMITATIONS,'supportingEvidence':[c['id'] for c in calls],'modelReferences':[scenario['prediction']['modelVersion']]}
    return {'mode':mode,'summary':message,'toolCalls':calls,'plan':plan}
