THREE.ParticleSystem = function( options ){

    THREE.Object3D.apply( this, arguments );

    options = options || {};

    this.GUI;

    THREE.ShaderChunk.gpuparticle_pars = "\nattribute vec2 reference;\nattribute float birthTime;\nattribute vec4 color;\nattribute float lifetime;\nattribute float size;\nuniform float uTime;\nuniform bool attenSize;\nuniform sampler2D textureOffset;\nuniform sampler2D textureVelocity;\n";

    THREE.ShaderChunk.begin_vertex_modified = "\nfloat t = uTime - birthTime;\nvec3 finalPosition = position * size + texture2D( textureOffset, reference ).xyz;\nvec3 transformed = vec3( finalPosition );\n";

    THREE.ShaderChunk.morphtarget_vertex_modified = "#ifdef USE_MORPHTARGETS\n\ttransformed += ( morphTarget0 - finalPosition ) * morphTargetInfluences[ 0 ];\n\ttransformed += ( morphTarget1 - finalPosition ) * morphTargetInfluences[ 1 ];\n\ttransformed += ( morphTarget2 - finalPosition ) * morphTargetInfluences[ 2 ];\n\ttransformed += ( morphTarget3 - finalPosition ) * morphTargetInfluences[ 3 ];\n\t#ifndef USE_MORPHNORMALS\n\ttransformed += ( morphTarget4 - finalPosition ) * morphTargetInfluences[ 4 ];\n\ttransformed += ( morphTarget5 - finalPosition ) * morphTargetInfluences[ 5 ];\n\ttransformed += ( morphTarget6 - finalPosition ) * morphTargetInfluences[ 6 ];\n\ttransformed += ( morphTarget7 - finalPosition ) * morphTargetInfluences[ 7 ];\n\t#endif\n#endif\n";

    THREE.ShaderChunk.GPU_Physics_Offset_Frag = `
        uniform float delta;
        uniform sampler2D updated;
        uniform sampler2D newPos;
        uniform sampler2D newVel;

        void main() {

            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec4 tmpPos = texture2D( textureOffset, uv );
            vec4 velocity = texture2D( textureVelocity, uv );

            float isUpdated = texture2D( updated, uv ).x;
            if( isUpdated > 0.0 ){
                tmpPos = texture2D( newPos, uv );
                velocity = texture2D( newVel, uv );
            }

            vec3 position = tmpPos.xyz;

            gl_FragColor = vec4( position + velocity.xyz * delta, 1 );

        }
    `;

    THREE.ShaderChunk.GPU_Physics_Velocity_Frag = `

        const float G = 6.67E-11;
        const float k_e = 9.0E9;

        uniform float delta;
        uniform sampler2D textureMass;
        uniform sampler2D updated;
        uniform sampler2D newPos;
        uniform sampler2D newVel;

        #if ( NUM_CONST_PHYS_ATTR > 0 )
            struct ConstantForceField {
                    vec3 direction;
                    float magnitude;
                };
            uniform ConstantForceField forcefields_const[ NUM_CONST_PHYS_ATTR ];
        #endif
        #if ( NUM_GRAV_PHYS_ATTR > 0 )
            struct GravForceField {
                    vec3 position;
                    float mass;
                    float decay;
                };
            uniform GravForceField forcefields_grav[ NUM_GRAV_PHYS_ATTR ];
        #endif
        #if ( NUM_COUL_PHYS_ATTR > 0 )
            struct CoulForceField {
                    vec3 position;
                    float charge;
                    float decay;
                };
            uniform CoulForceField forcefields_coul[ NUM_COUL_PHYS_ATTR ];
        #endif

        void main() {

            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec4 uVel = texture2D( textureVelocity, uv );
            vec4 COM = texture2D( textureOffset, uv );
            vec3 resForce = vec3( 0, 0, 0 );

            float mass = texture2D( textureMass, uv ).x;

            float isUpdated = texture2D( updated, uv ).x;
            if( isUpdated > 0.0 ){
                uVel = texture2D( newVel, uv );
                COM = texture2D( newPos, uv );
            }

            #if NUM_CONST_PHYS_ATTR > 0
                ConstantForceField forcefield_const;
                #pragma unroll_loop
                    for ( int i = 0; i < NUM_CONST_PHYS_ATTR; i ++ ) {
                        forcefield_const = forcefields_const[ i ];
                        resForce += forcefield_const.direction * forcefield_const.magnitude / mass;
                    }
            #endif

            #if NUM_GRAV_PHYS_ATTR > 0
                GravForceField forcefield_grav;
                vec3 radius;
                #pragma unroll_loop
                    for ( int i = 0; i < NUM_GRAV_PHYS_ATTR; i ++ ) {
                        forcefield_grav = forcefields_grav[ i ];
                        radius = COM.xyz - forcefield_grav.position;
                        resForce += - G * normalize( radius ) * forcefield_grav.mass * mass / pow( length( radius ), forcefield_grav.decay );
                    }
            #endif

            #if NUM_COUL_PHYS_ATTR > 0
                CoulForceField forcefield_coul;
                #pragma unroll_loop
                    for ( int i = 0; i < NUM_COUL_PHYS_ATTR; i ++ ) {
                        forcefield_coul = forcefields_grav[ i ];
                        distance = COM.xyz - forcefield_coul.position;
                        if( length( distance ) < forcefield_coul.radius ){
                            resForce += normalize( distance ) * forcefield_coul.strength * ( forcefield_coul.radius - length( distance ) ) / ( forcefield_coul.radius * pow( length( distance ), forcefield_coul.decay ) );
                        }
                    }
            #endif

            vec3 vVel = uVel.xyz + ( resForce / mass ) * delta;
            gl_FragColor = vec4( vVel, 1 );

        }
    `;

    this.params = {

        TIME_SCALE: options.timeScale !== undefined ? options.timeScale : 1,

        //Emitter
        MAX_PARTICLES: options.maxParticles !== undefined ? options.maxParticles : 10000,
        SPAWN_RATE: options.spawnRate !== undefined ? options.spawnRate : 100,
        ANIMATE_SPAWN: false, //Less memory efficient, stops rebuilding on spawn value change

        SPAWN_EMITFROM: "face", //origin, vert, face, volume(WIP)
        SPAWN_ELDISTRIB: "random", //index, random,
        SPAWN_INDEX: 0,
        SPAWN_EMDISTRIB: "random", //centre, random(WIP) //grid(future job)//,
        GRID_RESOLUTION: 1,

        //Particles
        SIZE: options.size !== undefined ? options.size : 1,
        VAR_SIZE: options.varySize !== undefined ? options.varySize : 0,

        LIFETIME: options.lifetime !== undefined ? options.lifetime : 5,
        VAR_LIFETIME: options.varyLifetime !== undefined ? options.varyLifetime : 0,

        INIT_POS: this.opt_ToVec( options.initPosition !== undefined ? options.initPosition : 0 ),
        VAR_POS: this.opt_ToVec( options.varyPosition !== undefined ? options.varyPosition : 0 ),

        INIT_VEL: this.opt_ToVec( options.initVelocity !== undefined ? options.initVelocity : new THREE.Vector3( 0, 0, 0 ) ),
        NORM_VEL: options.normalVelocity !== undefined ? options.normalVelocity : 1,
        VAR_NORM_VEL: options.varyNormalVelocity !== undefined ? options.varyNormalVelocity : 0,
        VAR_VEL: this.opt_ToVec( options.varyVelocity !== undefined ? options.varyVelocity : 0 ),

        INIT_COL: this.opt_ToQuat( options.initColour !== undefined ? options.initColour : 1 ),
        VAR_COL: this.opt_ToQuat( options.varyColour !== undefined ? options.varyColour : 0 ),

        //Display
        DISPLAY_MODE: "shader", //shader, object, group
        INSTANCED: options.instanceObject !== undefined ? options.instanceObject : null,

        //Physics
        ENABLE_PHYSICS : true,

    }

    this.ACTIVE_PARTICLE = 0;
    this.PARTICLE_LIMIT_REACHED = false;

    this.TIME = 0;

    this.forceCarriers = { 0: [], 1: [], 2: [] };

    this._rateCounter = 0;
    this._offset = 0;
    this._count = 0;

    this.VERTEX_SHADER = `

        #include <gpuparticle_pars>

        varying vec4 vColor;
        varying vec2 vUv;

        void main() {

            vColor = color;
            vUv = uv;

            float age = uTime - birthTime;

            if( age >= 0. && age < lifetime ){

                vec4 mvPosition = modelViewMatrix * vec4( ( position + texture2D( textureOffset, reference ).xyz ), 1.0 );

                gl_PointSize = size;

                if( attenSize ){
                    if( projectionMatrix[2][3] == -1.0 ) gl_PointSize *= 20.0 / -mvPosition.z; //SIZE ATTENUATION
                }

                gl_Position = projectionMatrix * mvPosition;

            } else{

                gl_PointSize = 0.;

            }

        }
    `;

    this.FRAG_SHADER = `
        varying vec4 vColor;
        varying vec2 vUv;

        void main() {

            gl_FragColor = vec4( vColor );

        }
    `;


    this.raycaster = new THREE.Raycaster();

    this.DPR = window.devicePixelRatio;
    this.isParticleSystem = true;

    this.init();

}

THREE.ParticleSystem.prototype = Object.create( THREE.Object3D.prototype );
THREE.ParticleSystem.prototype.constructor = THREE.ParticleSystem;

Object.assign( THREE.ParticleSystem.prototype, {

    init: function( overwrite ){

        if( this.points && !overwrite ){ console.warn( "System already initialised! Use .init( true ) to overwrite." ); return };

        this.initComputeRenderer();

        this.ACTIVE_PARTICLE = 0;
        this.rateCounter = 0;
        this.TIME = 0;

        if( this.points ){ this.dispose(); };

        this.remove( this.points );
        this.points = this.params.DISPLAY_MODE === "object" && this.instanceObject ? new THREE.Mesh() : new THREE.Points();
        this.refreshPoints();

        this.add( this.points );

    },

    refreshPoints: function(){

        this.refreshGeo();
        this.refreshMaterial();

    },

    initComputeRenderer: function( rewrite ){

        let physObjs = this.enablePhysics ? this.forceCarriers : [];
        const Velocity_Frag = THREE.ShaderChunk.GPU_Physics_Velocity_Frag.replace( /NUM_CONST_PHYS_ATTR/g, physObjs[0].length ).replace( /NUM_GRAV_PHYS_ATTR/g, physObjs[1].length ).replace( /NUM_COUL_PHYS_ATTR/g, physObjs[2].length );

        let texSize = Math.pow( 2, Math.ceil( Math.log2( Math.sqrt( this._softParticleLimit ) ) ) );
        let gpuCompute = new GPUComputationRenderer( texSize, texSize, renderer );
        gpuCompute.texSize = texSize;

        let dataOffset = gpuCompute.createTexture();
        let dataVelocity = gpuCompute.createTexture();

        let offsetVar = gpuCompute.addVariable( "textureOffset", THREE.ShaderChunk.GPU_Physics_Offset_Frag, dataOffset );
        let velocityVar = gpuCompute.addVariable( "textureVelocity", Velocity_Frag, dataVelocity );

        velocityVar.wrapS = THREE.RepeatWrapping;
        velocityVar.wrapT = THREE.RepeatWrapping;
        offsetVar.wrapS = THREE.RepeatWrapping;
        offsetVar.wrapT = THREE.RepeatWrapping;

        gpuCompute.setVariableDependencies( offsetVar, [ velocityVar, offsetVar ] );
        gpuCompute.setVariableDependencies( velocityVar, [ velocityVar, offsetVar ] );

        let updated, newVel, newPos, mass;
        let updatedUniform, newVelUniform, newPosUniform, massUniform;

        if( !this.gpuCompute || rewrite ){

            updated = new Uint8Array( Math.pow( texSize, 2 ) * 3 );
            newVel = new Float32Array( Math.pow( texSize, 2 ) * 3 );
            newPos = new Float32Array( Math.pow( texSize, 2 ) * 3 );
            mass = new Float32Array( Math.pow( texSize, 2 ) * 3 );

        } else{

            updated = new Uint8Array( Math.pow( texSize, 2 ) * 3 )
            updated.set( this.offsetVar.material.uniforms.updated.value.image.data );
            newVel = new Float32Array( Math.pow( texSize, 2 ) * 3 )
            newVel.set( this.offsetVar.material.uniforms.newVel.value.image.data );
            newPos = new Float32Array( Math.pow( texSize, 2 ) * 3 )
            newPos.set( this.offsetVar.material.uniforms.newPos.value.image.data );
            mass = new Float32Array( Math.pow( texSize, 2 ) * 3 )
            mass.set( this.velocityVar.material.uniforms.textureMass.value.image.data );

        }

        updatedUniform = { value: new THREE.DataTexture( updated, texSize, texSize, THREE.RGBFormat )};
        newVelUniform = { value: new THREE.DataTexture( newVel, texSize, texSize, THREE.RGBFormat, THREE.FloatType ) };
        newPosUniform = { value: new THREE.DataTexture( newPos, texSize, texSize, THREE.RGBFormat, THREE.FloatType ) };
        massUniform = { value: new THREE.DataTexture( mass, texSize, texSize, THREE.RGBFormat, THREE.FloatType ) };

        let offsetUniforms = offsetVar.material.uniforms;
        let velocityUniforms = velocityVar.material.uniforms;

        offsetUniforms.delta = { value: 0.0 };
        offsetUniforms.newPos = newPosUniform;
        offsetUniforms.newVel = newVelUniform;
        offsetUniforms.updated = updatedUniform;

        velocityUniforms.delta = { value: 0.0 };
        velocityUniforms.updated = updatedUniform;
        velocityUniforms.newPos = newPosUniform;
        velocityUniforms.newVel = newVelUniform;
        velocityUniforms.textureMass = massUniform;
        velocityUniforms.forcefields_const = {
            properties: { direction: {}, magnitude: {} },
            value: physObjs[0]
        };
        velocityUniforms.forcefields_grav = {
            properties: { position: {}, mass: {}, decay: {} },
            value: physObjs[1]
        };
        velocityUniforms.forcefields_coul = {
            properties: { position: {}, charge: {}, decay: {} },
            value: physObjs[2]
        };

        let error = gpuCompute.init();
        if ( error !== null ) {
            console.error( error );
        };
        this.gpuCompute = gpuCompute;
        this.offsetVar = offsetVar;
        this.velocityVar = velocityVar;

    },

    calcOffset: function( position, velocity ){

        //Position
        let sourceIndex;
        let source;
        let index;
        let normal = new THREE.Vector3();

        switch( this.params.SPAWN_ELDISTRIB ){

            case "index":

                sourceIndex = pool => this.params.SPAWN_INDEX >= pool.length ? pool.length - 1 : this.params.SPAWN_INDEX;
                break;

            case "random":

                sourceIndex = pool => THREE.Math.randInt( 0, pool.length - 1 );
                break;

        }

        switch( this.params.SPAWN_EMITFROM ){

            case "origin":


                source = this.parent.position;
                normal = this.parent.up;
                position.add( source );
                break;

            case "vert":

                index = sourceIndex( this.parent.geometry.vertices )

                source = this.parent.geometry.vertices[ index ];
                normal = this.parent.geometry.faces.map( face => face.vertexNormals[ Object.values( face ).indexOf( index ) ] ).filter( el => el )[0];
                position.add( source );

                break;

            case "face":

                index = sourceIndex( this.parent.geometry.faces )

                normal = this.parent.geometry.faces[ index ].normal;
                source = this.find3DPos( Object.values( this.parent.geometry.faces[ index ] ).slice( 0, 3 ).map( vert => this.parent.geometry.vertices[ vert ] ), normal.clone() );
                position.add( source );

                break;

            case "volume":

                normal = this.parent.up;
                source = this.find3DPos( this.parent.geometry.vertices, normal.clone() );
                position.add( source );
                break;

        }



        return [ position, normal ]

    },

    find3DPos: function( source, normal ){

        let pos = new THREE.Vector3();

        switch( this.params.SPAWN_EMDISTRIB ){

            case "centre":

                pos.x = source.reduce( ( acc, vert ) => acc + vert.x, 0)/source.length;
                pos.y = source.reduce( ( acc, vert ) => acc + vert.y, 0)/source.length;
                pos.z = source.reduce( ( acc, vert ) => acc + vert.z, 0)/source.length;

                break;

            case "random":

                let genPos;

                switch( this.params.SPAWN_EMITFROM ){

                    case "face":

                        genPos = () => new THREE.Vector3().subVectors( source[1], source[0] ).multiplyScalar( Math.random() ).add( new THREE.Vector3().subVectors( source[2], source[0] ).multiplyScalar( Math.random() ) ).add( source[0] );

                        break;

                    case "volume":

                        genPos = () => {

                            const tmp = new THREE.Vector3().subVectors( this.parent.geometry.boundingBox.max, this.parent.geometry.boundingBox.min )
                            tmp.x = tmp.x * Math.random();
                            tmp.y = tmp.y * Math.random();
                            tmp.z = tmp.z * Math.random();

                            return tmp.add( this.parent.geometry.boundingBox.min );

                        };

                        break;

                }

                pos = genPos();
                this.raycaster.set( pos, normal.clone().negate() );

                while( this.raycaster.intersectObject( this.parent ).length === 0 ) {

                    pos = genPos();
                    this.raycaster.set( pos, normal.clone().negate() );

                }

                break;

        }

        return pos

    },

    assignForceCarrier: function( value ){

        if( value.isForceCarrier ) this.forceCarriers[value.type].push( value );
        this.initComputeRenderer();

    },

    removeForceCarrier: function( value ){

        this.forceCarriers.splice( this.forceCarriers.indexOf( value ), 1 );

    },

    opt_ToVec: function( value ){

        let option;

        if( value instanceof THREE.Vector3 ){
            option = value;
        } else if( value instanceof Object ){
            option = new THREE.Vector3( value.x, value.y, value.z );
        } else{
            option = new THREE.Vector3( value, value, value );
        }

        return option


    },

    opt_ToQuat: function( value ){

        let option;

        if( value instanceof THREE.Quaternion ){
            option = value;
        } else if( value instanceof Object ){
            option = new THREE.Quaternion( value.x || value.r, value.y || value.g, value.z || value.b, value.w || value.a );
        } else{
            option = new THREE.Quaternion( value, value, value, value );
        }

        return option


    },

    refreshGeo: function(){

        let particleGeo;
        let attrBuilder;

        if( this.params.DISPLAY_MODE === "object" && this.instanceObject ){

            particleGeo = new THREE.InstancedBufferGeometry();
            attrBuilder = ( arrSize, itemSize ) => new THREE.InstancedBufferAttribute( new Float32Array( arrSize * itemSize ), itemSize ).setDynamic( true );

            const instanceGeo = new THREE.BufferGeometry().fromGeometry( this.instanceObject.geometry );

            particleGeo.addAttribute( 'position',   instanceGeo.attributes.position );
            particleGeo.addAttribute( 'normal',     instanceGeo.attributes.normal );
            particleGeo.addAttribute( 'color',      instanceGeo.attributes.color );
            particleGeo.addAttribute( 'uv',         instanceGeo.attributes.uv );

        } else{

            particleGeo = new THREE.BufferGeometry();
            attrBuilder = ( arrSize, itemSize ) => new THREE.BufferAttribute( new Float32Array( arrSize * itemSize ), itemSize ).setDynamic( true );

            particleGeo.addAttribute( 'position',  attrBuilder( this._softParticleLimit, 3 ) );
            particleGeo.addAttribute( 'color',     attrBuilder( this._softParticleLimit, 4 ) );

        }

        particleGeo.addAttribute( 'reference',  attrBuilder( this._softParticleLimit, 2 ) );
        particleGeo.addAttribute( 'birthTime',  attrBuilder( this._softParticleLimit, 1 ) );
        particleGeo.addAttribute( 'size',       attrBuilder( this._softParticleLimit, 1 ) );
        particleGeo.addAttribute( 'lifetime',   attrBuilder( this._softParticleLimit, 1 ) );

        this.points.geometry = particleGeo;
        return particleGeo;

    },

    refreshMaterial: function(){

        let particleMat;

        let uniforms = {
            'uTime': {
                value: 0.0
            },
            'attenSize' : {
                value: true
            },
            'textureOffset': {
                value: this.gpuCompute.getCurrentRenderTarget( this.offsetVar ).texture
            },
            'textureVelocity': {
                value: this.gpuCompute.getCurrentRenderTarget( this.velocityVar ).texture
            }
        };

        if( this.params.DISPLAY_MODE === "object" && this.instanceObject ){

            particleMat = this.instanceObject.material.clone();

            particleMat.uniforms = Object.assign( particleMat.uniforms || {}, uniforms );

            particleMat.onBeforeCompile = ( shader, renderer ) => {

                shader.vertexShader = "\n#include <gpuparticle_pars>\n" + shader.vertexShader.replace( "begin_vertex", "begin_vertex_modified" ).replace( "morphtarget_vertex", "morphtarget_vertex_modified" );

                shader.uniforms = Object.assign( shader.uniforms, uniforms );

            };

        } else{

            particleMat =  new THREE.ShaderMaterial( {

                                        vertexShader: this.VERTEX_SHADER,
                                        fragmentShader: this.FRAG_SHADER,
                                        uniforms: uniforms,
                                        blending: THREE.NormalBlending,
                                        transparent: true,

                                    });


        }

        if( this.points.material ){ this.points.material.dispose();}
        this.points.material = particleMat;

        return particleMat

    },

    exportState: function(){

        console.log ( JSON.stringify( this.params ) );

    },

    spawnParticle: function(){

        const varyAttribute = attr => attr * THREE.Math.randFloat( -1, 1 );
        const i = this.ACTIVE_PARTICLE;

        this.offsetVar.material.uniforms.updated.value.image.data[ i * 3 ] = 1;
        this._offset = this._offset === null ? i : this._offset;
        this._count++;

        const referenceAttribute =  this.points.geometry.getAttribute( 'reference' );
        const birthTimeAttribute =  this.points.geometry.getAttribute( 'birthTime' );
        const colourAttribute =     this.points.geometry.getAttribute( 'color' );
        const sizeAttribute =       this.points.geometry.getAttribute( 'size' );
        const lifetimeAttribute =   this.points.geometry.getAttribute( 'lifetime' );


        //Texture Reference
        referenceAttribute.array[ i * 2 ] = ( i % this.gpuCompute.texSize ) / this.gpuCompute.texSize;
        referenceAttribute.array[ i * 2 + 1 ] = ~~( i / this.gpuCompute.texSize ) / this.gpuCompute.texSize;


        let [ position, normal ] = this.calcOffset( this.params.INIT_POS.clone() );

        //Position
        let newPos = this.offsetVar.material.uniforms.newPos.value.image.data;

        Object.keys( position ).forEach( ( dim, j ) => {
            newPos[ i * 3 + j ] = position[dim] + varyAttribute( this.params.VAR_POS[dim] );
        });

        //Velocity
        let newVel = this.velocityVar.material.uniforms.newVel.value.image.data;

        Object.keys( this.params.INIT_VEL ).forEach( ( dim, j ) => {
            newVel[ i * 3 + j ] = this.params.INIT_VEL[dim] + this.params.NORM_VEL * ( 1 - varyAttribute( this.params.VAR_NORM_VEL ) ) * normal[dim] + varyAttribute( this.params.VAR_VEL[dim] );
        });

        //Colour
        const colour = this.initColour.clone();

        Object.keys( colour ).forEach( ( dim, j ) => {

            colour[dim] = THREE.Math.clamp( colour[dim] + varyAttribute( this.params.VAR_COL[dim] ), 0, 1 );
            colourAttribute.array[ i * 4 + j ] = colour[dim];

        });

        //Mass
        this.velocityVar.material.uniforms.textureMass.value.image.data[ i * 3 ] = 1.0;

        // size, lifetime and starttime
        sizeAttribute.array[ i ] = this.params.SIZE + varyAttribute( this.params.VAR_SIZE );
        lifetimeAttribute.array[ i ] = this.params.LIFETIME + varyAttribute( this.params.VAR_LIFETIME );
        birthTimeAttribute.array[ i ] = this.TIME;

        this.ACTIVE_PARTICLE = this.ACTIVE_PARTICLE >= this._softParticleLimit ? 0 : this.ACTIVE_PARTICLE + 1;

    },

    updateGeo: function(){

        if( this._count < 1 ) return;

        ['reference', 'birthTime', 'color', 'size', 'lifetime'].forEach( attrName => {

            const attr = this.points.geometry.getAttribute( attrName );

            attr.updateRange.count = this._count * attr.itemSize;
            attr.updateRange.offset = this._offset * attr.itemSize;

            attr.needsUpdate = true;

        })

        this.offsetVar.material.uniforms.updated.value.needsUpdate = true;
        this.offsetVar.material.uniforms.newPos.value.needsUpdate = true;
        this.velocityVar.material.uniforms.newVel.value.needsUpdate = true;
        this.velocityVar.material.uniforms.textureMass.value.needsUpdate = true;

    },

    update: function(){

        if( !this.parent ){ console.warn( "No parent object!" ); return; };

        const delta = clock.getDelta() * this.params.TIME_SCALE;

        this.TIME += delta;
        this._count = 0;
        this._offset = null;
        this.offsetVar.material.uniforms.updated.value.image.data.fill( 0 );

        if( this.TIME < 0 ) this.TIME = 0;

        if ( delta > 0 && this.TIME > this.rateCounter/this.params.SPAWN_RATE ) {

            for( let i = 0; i < this.params.SPAWN_RATE*delta; i++){

                this.rateCounter++;
                this.spawnParticle();

            }

        }

        this.updateGeo();

        this.offsetVar.material.uniforms.delta.value = delta;
        this.velocityVar.material.uniforms.delta.value = delta;

        this.gpuCompute.compute();

        this.points.material.uniforms.uTime.value = this.TIME;
        this.points.material.uniforms.textureOffset.value = this.gpuCompute.getCurrentRenderTarget( this.offsetVar ).texture;
        this.points.material.uniforms.textureVelocity.value = this.gpuCompute.getCurrentRenderTarget( this.velocityVar ).texture;

    },

    dispose: function () {

        this.points.geometry.dispose();
        this.points.geometry = null;
        this.points.material.dispose();
        this.points.material = null;

	},

    buildOptions: function(){

        if( !this.parent ){ console.warn( "No parent object!" ); return; };

        let gui = new dat.GUI();
        this.GUI = gui;

        const assertNumericController = ( parent, name, toShow, rangeFrom, rangeTo ) => {
            cont = parent.__controllers.filter( cont => cont.property === name )[0];
            cont && cont.remove();
            if ( toShow ){
                parent.add( this, name, rangeFrom, rangeTo , 1 );
            }
        };

        const assertStringController = ( parent, name, toShow, range ) => {
            cont = parent.__controllers.filter( cont => cont.property === name )[0];
            cont && cont.remove();
            if ( toShow ){
                parent.add( this, name, range );
            }
        };

        const addVectorProp = ( parent, name, property, rangeFrom, rangeTo ) => {

            let cont = parent.addFolder( name );
            cont.add( property, "x", rangeFrom, rangeTo, 0.1 );
            cont.add( property, "y", rangeFrom, rangeTo, 0.1 );
            cont.add( property, "z", rangeFrom, rangeTo, 0.1 );
            property instanceof THREE.Quaternion &&  cont.add( property, "w", rangeFrom, rangeTo, 0.1 );

        };

        //////Emitter Settings//////
        let emitter = gui.addFolder( "Emitter" );
        emitter.add( this, "spawnRate", 0, 500, 10 );
        emitter.add( this, "animateSpawn" ).onChange( () => this.init( true ) );

        let source = emitter.addFolder( "Source" );
        const assertEmitIndex = () => assertNumericController( source, "emitIndex", ["vert","face"].includes( this.emitFrom ) && this.elementDistribution === "index", 0, ( this.emitFrom === "vert" ? this.parent.geometry.vertices.length : this.parent.geometry.faces.length ) - 1 );
        const assertEmitDistribution = () => assertStringController( source, "emitDistribution", ["face","volume"].includes( this.emitFrom ), { Centre: "centre", "Random(WIP)": "random", "//Grid": "grid" } );

        source.add( this, "emitFrom", { Centre: "origin", Vertex: "vert", Face: "face", Volume: "volume" } ).onChange( () => {assertEmitIndex(); assertEmitDistribution()} );
        source.add( this, "elementDistribution", { Index: "index", Random: "random" } ).onChange( () => {assertEmitIndex(); assertEmitDistribution()} );
        assertEmitIndex();
        assertEmitDistribution();

        //////Particle Settings//////
        let particle = gui.addFolder( "Particle" );

        let lifetime = particle.addFolder( "Lifetime" );
        lifetime.add( this, "lifetime", 0, 10, 0.1 );
        lifetime.add( this, "varyLifetime", 0, 10, 0.1 );

        let size = particle.addFolder( "Size" );
        size.add( this, "size", 0.1, 20, 0.1 );
        size.add( this, "varySize", 0, 20, 1 );

        let position = particle.addFolder( "Position" );
        addVectorProp( position, "Initial", this.initPosition, -5, 5 );
        addVectorProp( position, "Variance", this.varyPosition, 0 ,5 );
        let velocity = particle.addFolder( "Velocity" );
        velocity.add( this, "normalVelocity", -5, 5, 0.1 );
        velocity.add( this, "varyNormalVelocity", 0, 1, 0.1 );
        addVectorProp( velocity, "Initial", this.initVelocity, -5, 5 );
        addVectorProp( velocity, "Variance", this.varyVelocity, 0, 5 );
        let color = particle.addFolder( "Color" );
        addVectorProp( color, "Initial", this.initColour, 0, 1 );
        addVectorProp( color, "Variance", this.varyColour, 0, 1 );

        //////Display Settings//////
        let display = gui.addFolder( "Display" );
        display.add( this, "displayMode", {Point: "shader", Object: "object"});

        gui.add( this, "enablePhysics" );
        gui.add( this, "exportState" );

    },

    removeOptions: function(){

        this.GUI.destroy();
        this.GUI = undefined;

    }

});

Object.defineProperties( THREE.ParticleSystem.prototype, {

    "vertexShader": {

        get: function(){ return this.VERTEX_SHADER },

        set: function( value ){

            this.VERTEX_SHADER = value;
            this.refreshMaterial();

        }

    },
    "sizeAttenuation": {

        get: function(){ return this.points.material.uniforms.attenSize.value },

        set: function( value ){

            this.points.material.uniforms.attenSize.value = value;

        }

    },

    "fragShader": {

        get: function(){ return this.FRAG_SHADER },

        set: function( value ){

            this.FRAG_SHADER = value;
            this.refreshMaterial();

        }

    },

    "maxParticles": {

        get: function(){ return this.params.MAX_PARTICLES },

        set: function( value ){

            console.warn( "New particle limit. Rebuilding system." );
            this.params.MAX_PARTICLES = value;
            this.init( true );

        }

    },
    "_softParticleLimit": {

        get: function(){

            let tmp = this.PARTICLE_LIMIT_REACHED ? this.params.MAX_PARTICLES : this.params.SPAWN_RATE * ( this.params.LIFETIME + this.params.VAR_LIFETIME );

            if( tmp > this.params.MAX_PARTICLES ){

                tmp = this.params.MAX_PARTICLES;
                console.warn( "Max number of Particles will be exceeded with current Spawn Rate and Lifetime! Capping to .maxParticles; increase to remove limit." );
                this.PARTICLE_LIMIT_REACHED = true;

            }

            if( this.params.ANIMATE_SPAWN ) tmp = this.params.MAX_PARTICLES;

            return tmp

        },

       set: function( value ){ console.warn( "This value is used internally, there is nothing to set. Perhaps you meant to set .maxParticles?" ) }

    },
    "spawnRate": {

        get: function(){ return this.params.SPAWN_RATE },

        set: function( value ){

            this.params.SPAWN_RATE = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ); };

        }

    },
    "animateSpawn": {

        get: function(){ return this.params.ANIMATE_SPAWN },

        set: function( value ){

            this.params.ANIMATE_SPAWN = value
            console.warn( "Modifying .animateSpawn dynamically requires a rebuild. Call .init( true ) to reinitialise Particle System." )

        }

    },

    "emitFrom": {

        get: function(){ return this.params.SPAWN_EMITFROM },

        set: function( value ){ this.params.SPAWN_EMITFROM = value; }

    },
    "elementDistribution": {

        get: function(){ return this.params.SPAWN_ELDISTRIB },

        set: function( value ){

            this.params.SPAWN_ELDISTRIB = value;

            if( this.params.SPAWN_ELDISTRIB > ( this.params.SPAWN_EMITFROM === "vert" ? this.parent.geometry.vertices.length : this.parent.geometry.faces.length ) - 1 ) this.emitIndex = 0;

        }

    },
    "emitIndex": {

        get: function(){ return this.params.SPAWN_INDEX },

        set: function( value ){ this.params.SPAWN_INDEX = value }

    },
    "emitDistribution": {

        get: function(){ return this.params.SPAWN_EMDISTRIB },

        set: function( value ){ this.params.SPAWN_EMDISTRIB = value }

    },
    "gridResolution": {

        get: function(){ console.log( "Not yet implemented" ) },//return this.params.GRID_RESOLUTION },

        set: function( value ){ this.params.GRID_RESOLUTION = value }

    },

    "size": {

        get: function(){ return this.params.SIZE },

        set: function( value ){

            this.params.SIZE = value * this.DPR;

        }

    },
    "varySize": {

        get: function(){ return this.params.VAR_SIZE },

        set: function( value ){

            this.params.VAR_SIZE = value;

        }

    },

    "lifetime": {

        get: function(){ return this.params.LIFETIME },

        set: function( value ){

            this.params.LIFETIME = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ) };

        }

    },
    "varyLifetime": {

        get: function(){ return this.params.VAR_LIFETIME },

        set: function( value ){

            this.params.VAR_LIFETIME = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ) };

        }

    },

    "initPosition": {

        get: function(){ return this.params.INIT_POS },

        set: function( value ){

            this.params.INIT_POS = this.opt_FloatToVec( value );

        }

    },
    "varyPosition": {

        get: function(){ return this.params.VAR_POS },

        set: function( value ){

            this.params.VAR_POS = this.opt_FloatToVec( value );

        }

    },

    "normalVelocity": {

       get: function(){ return this.params.NORM_VEL },

       set: function( value ){ this.params.NORM_VEL = value }

    },
    "varyNormalVelocity": {

       get: function(){ return this.params.VAR_NORM_VEL },

       set: function( value ){ this.params.VAR_NORM_VEL = value }

    },
    "initVelocity": {

        get: function(){ return this.params.INIT_VEL },

        set: function( value ){

            this.params.INIT_VEL = this.opt_FloatToVec( value );

        }

    },
    "varyVelocity": {

        get: function(){ return this.params.VAR_VEL },

        set: function( value ){

            this.params.VAR_VEL = this.opt_FloatToVec( value );

        }

    },

    "initColour": {

        get: function(){ return this.params.INIT_COL },

        set: function( value ){

            this.params.INIT_COL = this.opt_FloatToVec( value );

        }

    },
    "varyColour": {

        get: function(){ return this.params.VAR_COL },

        set: function( value ){

            this.params.VAR_COL = this.opt_FloatToVec( value );

        }

    },

    "displayMode": {

        get: function(){ return this.params.DISPLAY_MODE },

        set: function( value ){

            this.params.DISPLAY_MODE = value;
            console.warn( "Modifying .displayMode dynamically requires a rebuild.")
            this.init( true );

        }

    },
    "instanceObject": {

        get: function(){ return this.params.INSTANCED },

        set: function( value ){

            this.params.INSTANCED = value;
            this.init( true );

        }

    },

    "enablePhysics": {

        get: function(){ return this.params.ENABLE_PHYSICS },

        set: function( value ){

            this.params.ENABLE_PHYSICS = value;
            this.refreshComputeRenderer();

        }

    },

})


THREE.ForceCarrier = function( options ){

    THREE.Object3D.apply( this, arguments );

    this.isForceCarrier = true;
    this.type = options.type !== undefined ? options.type : 1;
    this.decay = 1;

    switch( this.type ){

        case 0:
            this.direction = options.direction !== undefined ? options.direction.normalize() : new THREE.Vector3( 0, -1, 0 ).normalize();
            this.magnitude = options.magnitude !== undefined ? options.magnitude : 9.81;
            break;

        case 1:
            this.mass = options.mass !== undefined ? options.mass : 1;
            this.decay = options.decay !== undefined ? options.decay : 1;
            break;

        case 2:
            this.charge = 0;
            break;

    }

    options.showHelper && this.drawHelper();

};

THREE.ForceCarrier.prototype = Object.create( THREE.Object3D.prototype );
THREE.ForceCarrier.prototype.constructor = THREE.ForceCarrier;

Object.assign( THREE.ForceCarrier.prototype, {

    drawHelper: function(){

        let helperGeo;

        switch( this.type ){

            case 0: //Constant

                helperMesh = new THREE.Mesh( new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial( { wireframe : true } ) );
                helperMesh.up = new THREE.Vector3( 0, 0, 1 );
                helperMesh.add( new THREE.ArrowHelper( helperMesh.up, helperMesh.position, 1, 0xffffff ) );
                helperMesh.position.copy( this.position );
                helperMesh.lookAt( this.direction );
                this.add( helperMesh );
                break;

            case 1: //Gravity

                helperMesh = new THREE.Mesh( new THREE.SphereGeometry( this.radius, 6, 6 ), new THREE.MeshBasicMaterial( { wireframe : true } ) );
                helperMesh.position.copy( this.position );
                this.add( helperMesh );
                break;

            case 2: //Coulomb

                break;

        }

    }

});

Object.defineProperties( THREE.ForceCarrier.prototype, {

    "type": {

        get: function(){ return this._type },

        set: function( value ){ this._type = +value == +value? value : { "constant": 0, "gravity": 1, "coulomb": 2 }[value] }

    },

});

THREE.Geometry.prototype.computeVertexNormals_New = function ( areaWeighted ) {

		if ( areaWeighted === undefined ) areaWeighted = true;

		var v, vl, vA, vB, vC, f, fl, face, vertices, normal;

		vertices = new Array( this.vertices.length ).fill( 0 ).map( el => [] );

        this.faces.forEach( face => {

            if ( areaWeighted ) {

                // vertex normals weighted by triangle areas
                // http://www.iquilezles.org/www/articles/normals/normals.htm
                // cross-product of two adjacent regular polygon edges is directly proportional to polygon's area

    			var cb = new THREE.Vector3(), ab = new THREE.Vector3();

				vA = this.vertices[ face.a ];
				vB = this.vertices[ face.b ];
				vC = this.vertices[ face.c ];

				cb.subVectors( vC, vB );
				ab.subVectors( vA, vB );
				normal = cb.cross( ab );

		    } else {

    			this.computeFaceNormals();
                normal = face.normal;

            }

            //Test for planar duplicates (vectors pointing in same direction)
			!vertices[ face.a ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.a ].push( normal.clone() );
			!vertices[ face.b ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.b ].push( normal.clone() );
			!vertices[ face.c ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.c ].push( normal.clone() );

		});

        vertices = vertices.map( arr => arr.reduce( ( acc, vec ) => acc.add( vec ), new THREE.Vector3() ).normalize() );

		for ( f = 0, fl = this.faces.length; f < fl; f ++ ) {

			face = this.faces[ f ];

			var vertexNormals = face.vertexNormals;

			if ( vertexNormals.length === 3 ) {

                vertexNormals[ 0 ].copy( vertices[ face.a ] );
				vertexNormals[ 1 ].copy( vertices[ face.b ] );
				vertexNormals[ 2 ].copy( vertices[ face.c ] );

			} else {

				vertexNormals[ 0 ] = vertices[ face.a ].clone();
				vertexNormals[ 1 ] = vertices[ face.b ].clone();
				vertexNormals[ 2 ] = vertices[ face.c ].clone();

			}

		}

		if ( this.faces.length > 0 ) {

			this.normalsNeedUpdate = true;

		}

	}
