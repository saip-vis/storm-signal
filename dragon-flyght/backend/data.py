from pathlib import Path
import random, json, csv, re, difflib
ROOT=Path(__file__).resolve().parents[1]

def neighborhood():
    rng=random.Random(42); assets=[]
    kinds=['substation','telecom','road','road','pharmacy','clinic','grocery','community center','shelter','shelter','office','office','office','retail','retail','retail','retail','retail','apartments','apartments','apartments','apartments','apartments','apartments']+['house']*18
    names=['Cottonwood Substation','Northstar Telecom','Arapaho Access','Belt Line Access','Prairie Pharmacy','Richardson Clinic','Greenway Grocery','Cottonwood Community Center','Northside Shelter','Meadow Shelter','Meridian Offices','Arapaho Workspaces','Northstar Tower']
    for i,kind in enumerate(kinds):
        x=(i%7-3)*43+ rng.uniform(-5,5); z=(i//7-2.5)*48+rng.uniform(-5,5)
        res=kind in ('house','apartments'); cap= rng.randint(3,6) if kind=='house' else rng.randint(65,110) if kind=='apartments' else rng.randint(15,75)
        assets.append({'id':f'B{i+1:03}','name':names[i] if i<len(names) else f'{["Meadow","Prairie","Cottonwood","Willow","Arapaho","Creekside"][i%6]} {kind.title()} {i+1}','buildingType':kind,'worldX':round(x,2),'worldZ':round(z,2),'latitude':32.95+z/111000,'longitude':-96.73+x/93000,'yearBuilt':rng.randint(1970,2020),'constructionClass':'timber' if res else 'masonry','roofType':'pitched' if kind=='house' else 'flat','roofCondition':round(rng.uniform(.35,.95),2),'maintenanceScore':rng.randint(40,95),'replacementCost':rng.randint(2,10)*100000 if kind=='house' else rng.randint(15,65)*100000,'marketValue':rng.randint(20,90)*100000,'annualRevenue':rng.randint(3,25)*500000 if 4<=i<18 else 0,'occupantCapacity':cap,'criticality':3 if 4<=i<=9 else 1,'backupPower':kind=='clinic','floodProtection':False,'windProtection':False,'operationalStatus':'normal','source':'seeded synthetic portfolio v1','isSynthetic':True,'zone':f'Z{i%6+1}','width':16 if kind=='house' else 24,'height':8 if kind=='house' else 28 if kind=='office' else 16 if kind=='apartments' else 10})
    edges=[]
    for a in assets[4:]:
        for target,rel in [('B001','POWERED_BY'),('B003' if int(a['id'][1:])%2 else 'B004','ACCESSIBLE_VIA')]:
            edges.append({'sourceId':a['id'],'targetId':target,'relationshipType':rel,'confidence':1,'evidenceSource':'synthetic engineering topology','assumptionFlag':True})
    edges.append({'sourceId':'B002','targetId':'B001','relationshipType':'POWERED_BY','confidence':1,'evidenceSource':'synthetic topology','assumptionFlag':True})
    shelters=[{'id':f'S{i}','buildingId':b,'name':assets[int(b[1:])-1]['name'],'totalCapacity':cap,'confirmedAvailableCapacity':available,'accessibility':'step-free','verificationStatus':'verified synthetic','operatorApprovalRequired':True,'roadAccess':True,'source':'synthetic scenario','isSynthetic':True} for i,b,cap,available in [(1,'B008',150,90),(2,'B009',120,60),(3,'B010',100,0)]]
    requests=[{'id':f'REQ-{i+1:03}','zone':f'Z{i%6+1}','need':['shelter','transport','medication','food'][i%4],'people':rng.randint(1,5),'severity':['urgent','high','moderate'][i%3],'status':['unassessed','open','matched'][i%3],'source':'fictional household request','isSynthetic':True} for i in range(30)]
    businesses=[{'id':f'BUS-{i:03}','buildingId':a['id'],'businessType':a['buildingType'],'annualRevenue':a['annualRevenue'],'dailyRevenue':a['annualRevenue']/365,'employees':a['occupantCapacity']//2,'serviceCapacity':100 if a['criticality']==3 else 0,'downtimeCostPerDay':a['annualRevenue']/365*.2,'recoveryCost':5000,'source':'synthetic portfolio','isSynthetic':True} for i,a in enumerate(assets[4:18])]
    zones=[{'id':f'Z{i+1}','name':n,'source':'synthetic community','isSynthetic':True} for i,n in enumerate(['Cottonwood','Prairie Creek','Meadow North','Arapaho','Willow Bend','Creekside'])]
    return {'assets':assets,'edges':edges,'shelters':shelters,'requests':requests,'businesses':businesses,'zones':zones}

def normalize(rows,assets):
    lookup={re.sub(r'[^a-z0-9]','',a['name'].lower()):a for a in assets}; ids={a['id']:a for a in assets}; records=[]; issues=[]; seen=set()
    for row in rows:
        r={re.sub(r'[^a-z0-9]','',k.lower()):v for k,v in row.items()}
        rawid=str(r.get('buildingid',r.get('id',''))).upper().replace('-','').replace(' ','')
        if rawid.isdigit(): rawid=f'B{int(rawid):03}'
        name=re.sub(r'[^a-z0-9]','',str(r.get('name',r.get('propertyname',''))).lower())
        a=ids.get(rawid) or lookup.get(name)
        if not a:
            possible=difflib.get_close_matches(name,list(lookup),n=1,cutoff=.65)
            issues.append({'row':row,'status':'needs review','suggestedId':lookup[possible[0]]['id'] if possible else None});continue
        if a['id'] in seen: issues.append({'row':row,'status':'duplicate merged','assetId':a['id']});continue
        seen.add(a['id']);records.append({'assetId':a['id'],'name':a['name'],'raw':row,'source':'user-import','matchMethod':'exact normalized ID/name','isSynthetic':True})
    return {'records':records,'issues':issues,'inputCount':len(rows),'matchedCount':len(records),'reviewCount':sum(i['status']=='needs review' for i in issues)}

def export_demo():
    n=neighborhood(); (ROOT/'data/processed/neighborhood.json').write_text(json.dumps(n,indent=2))
    rows=[{'Building ID':a['id'].replace('B','b-') if i%2 else str(int(a['id'][1:])),'Property Name':a['name'].upper()+' ','Roof Score':a['roofCondition'] if i%5 else ''} for i,a in enumerate(n['assets'])]
    rows.extend([rows[0],{'Building ID':'??','Property Name':'Cottonwood Comunity Ctr','Roof Score':''}])
    with (ROOT/'data/raw/messy_properties.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=rows[0]);writer.writeheader();writer.writerows(rows)
    return n
